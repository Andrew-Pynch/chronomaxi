import type { Log } from "@prisma/client";
import type {
    CategoryStat,
    DailySummary,
    GetActivityData,
    HourlyStat,
    ProgramStat,
} from "~/lib/activity-types";

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const MM_PER_METER = 1_000;
const DAYS_IN_SUMMARY = 7;
const HOURS_IN_DAY = 24;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const startOfLocalDay = (date: Date): Date =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addLocalDays = (date: Date, days: number): Date =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const toLocalDateKey = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
};

const toDayLabel = (date: Date): string => {
    const weekday = WEEKDAY_LABELS[date.getDay()] ?? "";

    return `${weekday} ${date.getMonth() + 1}/${date.getDate()}`;
};

const createEmptyDailySummary = (date: Date): DailySummary => ({
    date: toLocalDateKey(date),
    label: toDayLabel(date),
    totalHours: 0,
    keystrokes: 0,
    leftClickCount: 0,
    rightClickCount: 0,
    middleClickCount: 0,
    mouseMovementInMeters: 0,
});

const createHourlyToday = (): HourlyStat[] => {
    const buckets: HourlyStat[] = [];

    for (let hour = 0; hour < HOURS_IN_DAY; hour += 1) {
        buckets.push({
            hour,
            label: `${String(hour).padStart(2, "0")}:00`,
            keystrokes: 0,
            activeMinutes: 0,
        });
    }

    return buckets;
};

const formatDuration = (durationMs: number): string => {
    if (durationMs > 0 && durationMs < MS_PER_MINUTE) {
        return "<1m";
    }

    const totalMinutes = Math.floor(durationMs / MS_PER_MINUTE);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0 && minutes > 0) {
        return `${hours}h ${minutes}m`;
    }

    if (hours > 0) {
        return `${hours}h`;
    }

    return `${minutes}m`;
};

export const getStatsForLogs = (logs: Log[]): GetActivityData => {
    const todayStart = startOfLocalDay(new Date());
    const firstDayStart = addLocalDays(todayStart, -(DAYS_IN_SUMMARY - 1));
    const todayKey = toLocalDateKey(todayStart);

    const days = Array.from({ length: DAYS_IN_SUMMARY }, (_, index) =>
        createEmptyDailySummary(addLocalDays(firstDayStart, index)),
    );
    const dayByDate = new Map(days.map((day) => [day.date, day]));
    const hourlyToday = createHourlyToday();
    const programTotals = new Map<
        string,
        { durationMs: number; keystrokes: number }
    >();
    const categoryTotals = new Map<string, number>();
    let todayDurationMs = 0;

    for (const log of logs) {
        if (log.isIdle) {
            continue;
        }

        const createdAt = log.createdAt;
        const dateKey = toLocalDateKey(createdAt);
        const dailySummary = dayByDate.get(dateKey);
        const keystrokes = log.keysPressedCount ?? 0;
        const durationMs = log.durationMs;

        if (dailySummary) {
            dailySummary.totalHours += durationMs / MS_PER_HOUR;
            dailySummary.keystrokes += keystrokes;
            dailySummary.leftClickCount += log.leftClickCount ?? 0;
            dailySummary.rightClickCount += log.rightClickCount ?? 0;
            dailySummary.middleClickCount += log.middleClickCount ?? 0;
            dailySummary.mouseMovementInMeters +=
                (log.mouseMovementInMM ?? 0) / MM_PER_METER;
        }

        if (dateKey !== todayKey) {
            continue;
        }

        const hour = createdAt.getHours();
        const hourlyStat = hourlyToday[hour];

        if (hourlyStat) {
            hourlyStat.keystrokes += keystrokes;
            hourlyStat.activeMinutes += durationMs / MS_PER_MINUTE;
        }

        const program = programTotals.get(log.programName) ?? {
            durationMs: 0,
            keystrokes: 0,
        };
        program.durationMs += durationMs;
        program.keystrokes += keystrokes;
        programTotals.set(log.programName, program);

        categoryTotals.set(
            log.category,
            (categoryTotals.get(log.category) ?? 0) + durationMs,
        );
        todayDurationMs += durationMs;
    }

    const programsToday: ProgramStat[] = Array.from(programTotals.entries())
        .map(([program, stats]) => ({
            program,
            durationHours: stats.durationMs / MS_PER_HOUR,
            formattedDuration: formatDuration(stats.durationMs),
            keystrokes: stats.keystrokes,
        }))
        .sort((left, right) => right.durationHours - left.durationHours);

    const categoriesToday: CategoryStat[] = Array.from(categoryTotals.entries())
        .map(([category, durationMs]) => ({
            category,
            durationHours: durationMs / MS_PER_HOUR,
            percentage:
                todayDurationMs > 0 ? (durationMs / todayDurationMs) * 100 : 0,
        }))
        .sort((left, right) => right.durationHours - left.durationHours);

    return {
        days,
        today: dayByDate.get(todayKey) ?? createEmptyDailySummary(todayStart),
        hourlyToday,
        programsToday,
        categoriesToday,
        generatedAt: new Date().toISOString(),
    };
};
