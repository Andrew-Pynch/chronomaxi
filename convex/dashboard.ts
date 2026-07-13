import { v } from "convex/values";
import { query } from "./_generated/server";
import { TIMEZONE, localTimeParts } from "./lib/aggregation";

// getDashboard() reads ONLY the materialized aggregate tables --
// dayAgg/hourAgg/programAgg/categoryAgg -- never the spans table, so it
// stays fast and live-subscribable regardless of how many spans have
// accumulated. Field names/units mirror frontend/src/lib/activity-types.ts
// exactly (totalHours, keystrokes, activeMinutes, durationHours, ...) with
// an additional cheap actor split (human vs agent) at the day/hour/category
// level, since that math falls out of the same rollup rows for free.
//
// Every bucket table is now keyed per-device (schema.ts by_*_device
// indexes). getDashboard({device}) either narrows every series to that one
// device, or (device omitted) sums across every device server-side --
// callers never need to fan out per-device queries themselves.

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const MM_PER_METER = 1_000;
const DAYS_IN_SUMMARY = 7;
const HOURS_IN_DAY = 24;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDayKey(dayKey: string): { year: number; month: number; day: number } {
    const parts = dayKey.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (parts.length !== 3 || Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
        throw new Error(`malformed dayKey: ${dayKey}`);
    }
    return { year, month, day };
}

function formatDayKey(date: Date): string {
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${date.getUTCFullYear()}-${month}-${day}`;
}

function dayKeyLabel(dayKey: string): string {
    const { year, month, day } = parseDayKey(dayKey);
    // noon UTC avoids any DST-edge date-rollover surprise when deriving the
    // weekday label from a plain "YYYY-MM-DD" key.
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    const weekday = WEEKDAY_LABELS[date.getUTCDay()] ?? "?";
    return `${weekday} ${month}/${day}`;
}

function todayDayKey(): string {
    return localTimeParts(Date.now()).dayKey;
}

// Walks backward from todayKey one UTC-noon day at a time (see dayKeyLabel)
// so each key is computed independently of the local machine's own
// timezone -- always America/Chicago per TIMEZONE. The last entry is
// always exactly todayKey itself (loop ends at i=0, a zero-day offset).
function dayKeysBack(todayKey: string, count: number): string[] {
    const { year, month, day } = parseDayKey(todayKey);
    const keys: string[] = [];
    for (let i = count - 1; i >= 0; i -= 1) {
        const d = new Date(Date.UTC(year, month - 1, day, 12));
        d.setUTCDate(d.getUTCDate() - i);
        keys.push(formatDayKey(d));
    }
    return keys;
}

// Inclusive walk from startDayKey to endDayKey, both "YYYY-MM-DD" -- used
// only by getProgramDetail's explicit range mode (dayKeysBack above always
// anchors on "today", which doesn't fit an arbitrary historical range).
function dayKeysInRange(startDayKey: string, endDayKey: string): string[] {
    const start = parseDayKey(startDayKey);
    const end = parseDayKey(endDayKey);
    const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day, 12));
    const endDate = new Date(Date.UTC(end.year, end.month - 1, end.day, 12));
    if (cursor.getTime() > endDate.getTime()) {
        throw new Error(`startDayKey ${startDayKey} must be <= endDayKey ${endDayKey}`);
    }
    const keys: string[] = [];
    while (cursor.getTime() <= endDate.getTime()) {
        keys.push(formatDayKey(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return keys;
}

const dailySummaryValidator = v.object({
    date: v.string(),
    label: v.string(),
    totalHours: v.number(),
    humanHours: v.number(),
    agentHours: v.number(),
    keystrokes: v.number(),
    leftClickCount: v.number(),
    rightClickCount: v.number(),
    middleClickCount: v.number(),
    mouseMovementInMeters: v.number(),
});

const hourlyStatValidator = v.object({
    hour: v.number(),
    label: v.string(),
    keystrokes: v.number(),
    activeMinutes: v.number(),
    humanMinutes: v.number(),
    agentMinutes: v.number(),
});

const programStatValidator = v.object({
    program: v.string(),
    durationHours: v.number(),
    formattedDuration: v.string(),
    keystrokes: v.number(),
});

const categoryStatValidator = v.object({
    category: v.string(),
    durationHours: v.number(),
    percentage: v.number(),
    humanHours: v.number(),
    agentHours: v.number(),
});

const perDeviceDayValidator = v.object({
    dayKey: v.string(),
    deviceName: v.string(),
    durationMs: v.number(),
});

function formatDuration(durationMs: number): string {
    if (durationMs > 0 && durationMs < MS_PER_MINUTE) {
        return "<1m";
    }
    const totalMinutes = Math.floor(durationMs / MS_PER_MINUTE);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
}

export const getDashboard = query({
    args: { device: v.optional(v.string()) },
    returns: v.object({
        days: v.array(dailySummaryValidator),
        today: dailySummaryValidator,
        hourlyToday: v.array(hourlyStatValidator),
        programsToday: v.array(programStatValidator),
        categoriesToday: v.array(categoryStatValidator),
        generatedAt: v.string(),
        timezone: v.string(),
        // Every deviceName that has posted a dayAgg row within the last
        // DAYS_IN_SUMMARY days, sorted -- drives a device switcher.
        devices: v.array(v.string()),
        // Full per-device breakdown for the same 7-day window regardless of
        // `device` (unlike every field above, which narrows/sums per
        // `device`) -- enough for a stacked per-device chart alongside the
        // current selection's summary series.
        perDeviceDays: v.array(perDeviceDayValidator),
    }),
    handler: async (ctx, args) => {
        const device = args.device;
        const todayKey = todayDayKey();
        const dayKeys = dayKeysBack(todayKey, DAYS_IN_SUMMARY);

        // One query per day, every device -- the by_dayKey_device prefix
        // scan (dayKey only) also picks up pre-deviceName legacy rows
        // (deviceName unset), which fold into the device-unset sum below
        // exactly like a device-set dashboard would have seen them before
        // this field existed.
        const dayRowsByDay = await Promise.all(
            dayKeys.map((dayKey) =>
                ctx.db
                    .query("dayAgg")
                    .withIndex("by_dayKey_device", (q) => q.eq("dayKey", dayKey))
                    .collect(),
            ),
        );

        const deviceSet = new Set<string>();
        const perDeviceDays: { dayKey: string; deviceName: string; durationMs: number }[] = [];
        for (let i = 0; i < dayKeys.length; i += 1) {
            const dayKey = dayKeys[i]!;
            for (const row of dayRowsByDay[i]!) {
                if (row.deviceName === undefined) continue;
                deviceSet.add(row.deviceName);
                perDeviceDays.push({
                    dayKey,
                    deviceName: row.deviceName,
                    durationMs: row.totalDurationMs,
                });
            }
        }
        const devices = Array.from(deviceSet).sort();

        const days = dayKeys.map((dayKey, index) => {
            const rows = dayRowsByDay[index]!;
            const selected = device === undefined ? rows : rows.filter((row) => row.deviceName === device);
            const totalDurationMs = selected.reduce((sum, row) => sum + row.totalDurationMs, 0);
            const humanDurationMs = selected.reduce((sum, row) => sum + row.humanDurationMs, 0);
            const agentDurationMs = selected.reduce((sum, row) => sum + row.agentDurationMs, 0);
            return {
                date: dayKey,
                label: dayKeyLabel(dayKey),
                totalHours: totalDurationMs / MS_PER_HOUR,
                humanHours: humanDurationMs / MS_PER_HOUR,
                agentHours: agentDurationMs / MS_PER_HOUR,
                keystrokes: selected.reduce((sum, row) => sum + row.keysPressedCount, 0),
                leftClickCount: selected.reduce((sum, row) => sum + row.leftClickCount, 0),
                rightClickCount: selected.reduce((sum, row) => sum + row.rightClickCount, 0),
                middleClickCount: selected.reduce((sum, row) => sum + row.middleClickCount, 0),
                mouseMovementInMeters:
                    selected.reduce((sum, row) => sum + row.mouseMovementInMM, 0) / MM_PER_METER,
            };
        });
        const today = days.find((d) => d.date === todayKey);
        if (today === undefined) {
            throw new Error("today's dayKey must be present in the last 7 days");
        }

        const hourRows = await ctx.db
            .query("hourAgg")
            .withIndex("by_day_hour_device", (q) => q.eq("dayKey", todayKey))
            .collect();
        const selectedHourRows =
            device === undefined ? hourRows : hourRows.filter((row) => row.deviceName === device);
        const hourTotals = new Map<
            number,
            { keysPressedCount: number; totalDurationMs: number; humanDurationMs: number; agentDurationMs: number }
        >();
        for (const row of selectedHourRows) {
            const acc = hourTotals.get(row.hour) ?? {
                keysPressedCount: 0,
                totalDurationMs: 0,
                humanDurationMs: 0,
                agentDurationMs: 0,
            };
            acc.keysPressedCount += row.keysPressedCount;
            acc.totalDurationMs += row.totalDurationMs;
            acc.humanDurationMs += row.humanDurationMs;
            acc.agentDurationMs += row.agentDurationMs;
            hourTotals.set(row.hour, acc);
        }
        const hourlyToday = Array.from({ length: HOURS_IN_DAY }, (_, hour) => {
            const acc = hourTotals.get(hour);
            return {
                hour,
                label: `${String(hour).padStart(2, "0")}:00`,
                keystrokes: acc?.keysPressedCount ?? 0,
                activeMinutes: (acc?.totalDurationMs ?? 0) / MS_PER_MINUTE,
                humanMinutes: (acc?.humanDurationMs ?? 0) / MS_PER_MINUTE,
                agentMinutes: (acc?.agentDurationMs ?? 0) / MS_PER_MINUTE,
            };
        });

        const programRows = await ctx.db
            .query("programAgg")
            .withIndex("by_day_device_program", (q) => q.eq("dayKey", todayKey))
            .collect();
        const selectedProgramRows =
            device === undefined ? programRows : programRows.filter((row) => row.deviceName === device);
        const programTotals = new Map<string, { durationMs: number; keysPressedCount: number }>();
        for (const row of selectedProgramRows) {
            const acc = programTotals.get(row.program) ?? { durationMs: 0, keysPressedCount: 0 };
            acc.durationMs += row.durationMs;
            acc.keysPressedCount += row.keysPressedCount;
            programTotals.set(row.program, acc);
        }
        const programsToday = Array.from(programTotals.entries())
            .map(([program, acc]) => ({
                program,
                durationHours: acc.durationMs / MS_PER_HOUR,
                formattedDuration: formatDuration(acc.durationMs),
                keystrokes: acc.keysPressedCount,
            }))
            .sort((left, right) => right.durationHours - left.durationHours);

        const categoryRows = await ctx.db
            .query("categoryAgg")
            .withIndex("by_day_device_category", (q) => q.eq("dayKey", todayKey))
            .collect();
        const selectedCategoryRows =
            device === undefined ? categoryRows : categoryRows.filter((row) => row.deviceName === device);
        const categoryTotals = new Map<
            string,
            { durationMs: number; humanDurationMs: number; agentDurationMs: number }
        >();
        for (const row of selectedCategoryRows) {
            const acc = categoryTotals.get(row.category) ?? {
                durationMs: 0,
                humanDurationMs: 0,
                agentDurationMs: 0,
            };
            acc.durationMs += row.durationMs;
            acc.humanDurationMs += row.humanDurationMs;
            acc.agentDurationMs += row.agentDurationMs;
            categoryTotals.set(row.category, acc);
        }
        const todayTotalDurationMs = Array.from(categoryTotals.values()).reduce(
            (sum, acc) => sum + acc.durationMs,
            0,
        );
        const categoriesToday = Array.from(categoryTotals.entries())
            .map(([category, acc]) => ({
                category,
                durationHours: acc.durationMs / MS_PER_HOUR,
                percentage: todayTotalDurationMs > 0 ? (acc.durationMs / todayTotalDurationMs) * 100 : 0,
                humanHours: acc.humanDurationMs / MS_PER_HOUR,
                agentHours: acc.agentDurationMs / MS_PER_HOUR,
            }))
            .sort((left, right) => right.durationHours - left.durationHours);

        return {
            days,
            today,
            hourlyToday,
            programsToday,
            categoriesToday,
            generatedAt: new Date().toISOString(),
            timezone: TIMEZONE,
            devices,
            perDeviceDays,
        };
    },
});

type SubContextSource = "tmuxSession" | "tmuxCommand" | "windowTitle";

type SubContextTotals = {
    label: string;
    source: SubContextSource;
    durationMs: number;
    keysPressedCount: number;
    spanCount: number;
};

const TERMINAL_PROGRAMS: Record<string, true> = { alacritty: true, kitty: true };

const subContextStatValidator = v.object({
    label: v.string(),
    source: v.union(v.literal("tmuxSession"), v.literal("tmuxCommand"), v.literal("windowTitle")),
    durationHours: v.number(),
    formattedDuration: v.string(),
    keystrokes: v.number(),
    spanCount: v.number(),
});

function normalizedProgram(program: string): string {
    return program.trim().toLowerCase();
}

function dayQueryBounds(dayKey: string): { start: number; end: number } {
    const { year, month, day } = parseDayKey(dayKey);
    const utcMidnight = Date.UTC(year, month - 1, day);
    return {
        start: utcMidnight - 12 * MS_PER_HOUR,
        end: utcMidnight + 36 * MS_PER_HOUR,
    };
}

function addSubContext(
    totals: Map<string, SubContextTotals>,
    source: SubContextSource,
    label: string,
    durationMs: number,
    keysPressedCount: number,
    spanCount: number,
) {
    const cleanLabel = label.trim() || "Unknown window title";
    const key = `${source}:${cleanLabel}`;
    const acc = totals.get(key) ?? {
        label: cleanLabel,
        source,
        durationMs: 0,
        keysPressedCount: 0,
        spanCount: 0,
    };
    acc.durationMs += durationMs;
    acc.keysPressedCount += keysPressedCount;
    acc.spanCount += spanCount;
    totals.set(key, acc);
}

function clusterWindowTitle(title: string | undefined): string {
    const raw = title?.trim();
    if (!raw) return "Unknown window title";

    const suffixes = [
        " - Google Chrome",
        " - Chromium",
        " - Brave",
        " - Mozilla Firefox",
        " - Firefox",
    ];
    for (const suffix of suffixes) {
        if (raw.endsWith(suffix)) {
            return raw.slice(0, -suffix.length).trim() || raw;
        }
    }

    return raw;
}

function subContextsFromTotals(totals: Map<string, SubContextTotals>) {
    return Array.from(totals.values())
        .map((acc) => ({
            label: acc.label,
            source: acc.source,
            durationHours: acc.durationMs / MS_PER_HOUR,
            formattedDuration: formatDuration(acc.durationMs),
            keystrokes: acc.keysPressedCount,
            spanCount: acc.spanCount,
        }))
        .sort((left, right) => right.durationHours - left.durationHours);
}

// Sub-context breakdown for one program. Terminal programs use tmuxSession
// when the tracker captured it, with command buckets as a historical fallback.
// Non-terminal programs fall back to browserTitle clusters when those titles
// exist on spans.
export const getProgramDetail = query({
    args: {
        program: v.string(),
        device: v.optional(v.string()),
        dayKey: v.optional(v.string()),
        startDayKey: v.optional(v.string()),
        endDayKey: v.optional(v.string()),
    },
    returns: v.object({
        program: v.string(),
        device: v.union(v.string(), v.null()),
        dayKeys: v.array(v.string()),
        totalDurationHours: v.number(),
        totalFormattedDuration: v.string(),
        totalKeystrokes: v.number(),
        totalSpanCount: v.number(),
        contextLabel: v.string(),
        dataSource: v.union(v.literal("tmuxSession"), v.literal("tmuxCommand"), v.literal("windowTitle")),
        captureGap: v.union(v.string(), v.null()),
        subContexts: v.array(subContextStatValidator),
    }),
    handler: async (ctx, args) => {
        const dayKeys =
            args.dayKey !== undefined
                ? [args.dayKey]
                : args.startDayKey !== undefined || args.endDayKey !== undefined
                  ? dayKeysInRange(
                        args.startDayKey ?? args.endDayKey!,
                        args.endDayKey ?? args.startDayKey!,
                    )
                  : [todayDayKey()];

        const targetProgram = normalizedProgram(args.program);
        const device = args.device;
        const isTerminalProgram = TERMINAL_PROGRAMS[targetProgram] === true;

        if (isTerminalProgram) {
            const programRowsPerDay = await Promise.all(
                dayKeys.map((dayKey) =>
                    ctx.db
                        .query("programAgg")
                        .withIndex("by_day_device_program", (q) => q.eq("dayKey", dayKey))
                        .collect(),
                ),
            );
            const deviceNames = new Set<string>();
            for (const rows of programRowsPerDay) {
                for (const row of rows) {
                    if (normalizedProgram(row.program) !== targetProgram) continue;
                    if (device !== undefined && row.deviceName !== device) continue;
                    deviceNames.add(row.deviceName);
                }
            }

            const allBounds = dayKeys.map(dayQueryBounds);
            const queryStart = Math.min(...allBounds.map((bounds) => bounds.start));
            const queryEnd = Math.max(...allBounds.map((bounds) => bounds.end));
            const spanRows = await Promise.all(
                Array.from(deviceNames).map((deviceName) =>
                    ctx.db
                        .query("spans")
                        .withIndex("by_deviceName_startedAt", (q) =>
                            q
                                .eq("deviceName", deviceName)
                                .gte("startedAt", queryStart)
                                .lt("startedAt", queryEnd),
                        )
                        .collect(),
                ),
            );

            const dayKeySet = new Set(dayKeys);
            const totals = new Map<string, SubContextTotals>();
            let commandFallbackSpanCount = 0;
            for (const rows of spanRows) {
                for (const span of rows) {
                    if (normalizedProgram(span.programName) !== targetProgram) continue;
                    if (!dayKeySet.has(localTimeParts(span.startedAt).dayKey)) continue;
                    const active = !span.isIdle;
                    const session = span.tmuxSession?.trim();
                    if (session) {
                        addSubContext(
                            totals,
                            "tmuxSession",
                            session,
                            active ? span.durationMs : 0,
                            active ? span.keysPressedCount : 0,
                            active ? 1 : 0,
                        );
                    } else {
                        commandFallbackSpanCount += active ? 1 : 0;
                        addSubContext(
                            totals,
                            "tmuxCommand",
                            span.subProgram ? `command: ${span.subProgram}` : "Unknown tmux session",
                            active ? span.durationMs : 0,
                            active ? span.keysPressedCount : 0,
                            active ? 1 : 0,
                        );
                    }
                }
            }

            const subContexts = subContextsFromTotals(totals);
            const totalDurationMs = Array.from(totals.values()).reduce(
                (sum, acc) => sum + acc.durationMs,
                0,
            );

            return {
                program: args.program,
                device: device ?? null,
                dayKeys,
                totalDurationHours: totalDurationMs / MS_PER_HOUR,
                totalFormattedDuration: formatDuration(totalDurationMs),
                totalKeystrokes: Array.from(totals.values()).reduce(
                    (sum, acc) => sum + acc.keysPressedCount,
                    0,
                ),
                totalSpanCount: Array.from(totals.values()).reduce(
                    (sum, acc) => sum + acc.spanCount,
                    0,
                ),
                contextLabel: "tmux session",
                dataSource: "tmuxSession" as const,
                captureGap:
                    commandFallbackSpanCount > 0
                        ? "Some terminal spans predate tmux session capture; those rows are grouped by foreground command."
                        : null,
                subContexts,
            };
        }

        const programRowsPerDay = await Promise.all(
            dayKeys.map((dayKey) =>
                ctx.db
                    .query("programAgg")
                    .withIndex("by_day_device_program", (q) => q.eq("dayKey", dayKey))
                    .collect(),
            ),
        );
        const deviceNames = new Set<string>();
        for (const rows of programRowsPerDay) {
            for (const row of rows) {
                if (normalizedProgram(row.program) !== targetProgram) continue;
                if (device !== undefined && row.deviceName !== device) continue;
                deviceNames.add(row.deviceName);
            }
        }

        const allBounds = dayKeys.map(dayQueryBounds);
        const queryStart = Math.min(...allBounds.map((bounds) => bounds.start));
        const queryEnd = Math.max(...allBounds.map((bounds) => bounds.end));
        const spanRows = await Promise.all(
            Array.from(deviceNames).map((deviceName) =>
                ctx.db
                    .query("spans")
                    .withIndex("by_deviceName_startedAt", (q) =>
                        q
                            .eq("deviceName", deviceName)
                            .gte("startedAt", queryStart)
                            .lt("startedAt", queryEnd),
                    )
                    .collect(),
            ),
        );

        const dayKeySet = new Set(dayKeys);
        const totals = new Map<string, SubContextTotals>();
        for (const rows of spanRows) {
            for (const span of rows) {
                if (normalizedProgram(span.programName) !== targetProgram) continue;
                if (!dayKeySet.has(localTimeParts(span.startedAt).dayKey)) continue;
                const active = !span.isIdle;
                addSubContext(
                    totals,
                    "windowTitle",
                    clusterWindowTitle(span.browserTitle),
                    active ? span.durationMs : 0,
                    active ? span.keysPressedCount : 0,
                    active ? 1 : 0,
                );
            }
        }

        const subContexts = subContextsFromTotals(totals);
        const totalDurationMs = Array.from(totals.values()).reduce(
            (sum, acc) => sum + acc.durationMs,
            0,
        );

        return {
            program: args.program,
            device: device ?? null,
            dayKeys,
            totalDurationHours: totalDurationMs / MS_PER_HOUR,
            totalFormattedDuration: formatDuration(totalDurationMs),
            totalKeystrokes: Array.from(totals.values()).reduce(
                (sum, acc) => sum + acc.keysPressedCount,
                0,
            ),
            totalSpanCount: Array.from(totals.values()).reduce((sum, acc) => sum + acc.spanCount, 0),
            contextLabel: "window title",
            dataSource: "windowTitle" as const,
            captureGap: null,
            subContexts,
        };
    },
});

