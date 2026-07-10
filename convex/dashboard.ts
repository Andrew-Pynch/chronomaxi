import { v } from "convex/values";
import { query } from "./_generated/server";
import { TIMEZONE, localTimeParts } from "./lib/aggregation";

// getDashboard() reads ONLY the four materialized aggregate tables --
// dayAgg/hourAgg/programAgg/categoryAgg -- never the spans table, so it
// stays fast and live-subscribable regardless of how many spans have
// accumulated. Field names/units mirror frontend/src/lib/activity-types.ts
// exactly (totalHours, keystrokes, activeMinutes, durationHours, ...) with
// an additional cheap actor split (human vs agent) at the day/hour/category
// level, since that math falls out of the same rollup rows for free.

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
    args: {},
    returns: v.object({
        days: v.array(dailySummaryValidator),
        today: dailySummaryValidator,
        hourlyToday: v.array(hourlyStatValidator),
        programsToday: v.array(programStatValidator),
        categoriesToday: v.array(categoryStatValidator),
        generatedAt: v.string(),
        timezone: v.string(),
    }),
    handler: async (ctx) => {
        const todayKey = todayDayKey();
        const dayKeys = dayKeysBack(todayKey, DAYS_IN_SUMMARY);

        const dayRows = await Promise.all(
            dayKeys.map((dayKey) =>
                ctx.db
                    .query("dayAgg")
                    .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
                    .unique(),
            ),
        );

        const days = dayKeys.map((dayKey, index) => {
            const row = dayRows[index];
            return {
                date: dayKey,
                label: dayKeyLabel(dayKey),
                totalHours: (row?.totalDurationMs ?? 0) / MS_PER_HOUR,
                humanHours: (row?.humanDurationMs ?? 0) / MS_PER_HOUR,
                agentHours: (row?.agentDurationMs ?? 0) / MS_PER_HOUR,
                keystrokes: row?.keysPressedCount ?? 0,
                leftClickCount: row?.leftClickCount ?? 0,
                rightClickCount: row?.rightClickCount ?? 0,
                middleClickCount: row?.middleClickCount ?? 0,
                mouseMovementInMeters: (row?.mouseMovementInMM ?? 0) / MM_PER_METER,
            };
        });
        const today = days.find((d) => d.date === todayKey);
        if (today === undefined) {
            throw new Error("today's dayKey must be present in the last 7 days");
        }

        const hourRows = await ctx.db
            .query("hourAgg")
            .withIndex("by_dayKey_hour", (q) => q.eq("dayKey", todayKey))
            .collect();
        const hourByNumber = new Map(hourRows.map((row) => [row.hour, row]));
        const hourlyToday = Array.from({ length: HOURS_IN_DAY }, (_, hour) => {
            const row = hourByNumber.get(hour);
            return {
                hour,
                label: `${String(hour).padStart(2, "0")}:00`,
                keystrokes: row?.keysPressedCount ?? 0,
                activeMinutes: (row?.totalDurationMs ?? 0) / MS_PER_MINUTE,
                humanMinutes: (row?.humanDurationMs ?? 0) / MS_PER_MINUTE,
                agentMinutes: (row?.agentDurationMs ?? 0) / MS_PER_MINUTE,
            };
        });

        const programRows = await ctx.db
            .query("programAgg")
            .withIndex("by_dayKey_program", (q) => q.eq("dayKey", todayKey))
            .collect();
        const programsToday = programRows
            .map((row) => ({
                program: row.program,
                durationHours: row.durationMs / MS_PER_HOUR,
                formattedDuration: formatDuration(row.durationMs),
                keystrokes: row.keysPressedCount,
            }))
            .sort((left, right) => right.durationHours - left.durationHours);

        const categoryRows = await ctx.db
            .query("categoryAgg")
            .withIndex("by_dayKey_category", (q) => q.eq("dayKey", todayKey))
            .collect();
        const todayTotalDurationMs = categoryRows.reduce(
            (sum, row) => sum + row.durationMs,
            0,
        );
        const categoriesToday = categoryRows
            .map((row) => ({
                category: row.category,
                durationHours: row.durationMs / MS_PER_HOUR,
                percentage:
                    todayTotalDurationMs > 0
                        ? (row.durationMs / todayTotalDurationMs) * 100
                        : 0,
                humanHours: row.humanDurationMs / MS_PER_HOUR,
                agentHours: row.agentDurationMs / MS_PER_HOUR,
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
        };
    },
});
