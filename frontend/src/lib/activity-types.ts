// Shared contract between the server data layer (logHelpers/actions) and the UI.
// Server produces exactly this shape; components consume exactly this shape.

export type DailySummary = {
    /** Local date key, e.g. "2026-07-09" */
    date: string;
    /** Short display label, e.g. "Wed 7/9" */
    label: string;
    totalHours: number;
    keystrokes: number;
    leftClickCount: number;
    rightClickCount: number;
    middleClickCount: number;
    mouseMovementInMeters: number;
};

export type ProgramStat = {
    program: string;
    durationHours: number;
    /** e.g. "2h 14m" */
    formattedDuration: string;
    keystrokes: number;
};

export type CategoryStat = {
    category: string;
    durationHours: number;
    /** 0-100 */
    percentage: number;
};

export type HourlyStat = {
    /** 0-23, local time */
    hour: number;
    /** e.g. "14:00" */
    label: string;
    keystrokes: number;
    activeMinutes: number;
};

export type GetActivityData = {
    /** Last 7 calendar days (local), ascending, zero-filled for empty days */
    days: DailySummary[];
    /** Today's totals (local calendar day) */
    today: DailySummary;
    /** 24 buckets for today, hours 0-23, zero-filled */
    hourlyToday: HourlyStat[];
    /** Today's programs sorted by duration desc */
    programsToday: ProgramStat[];
    /** Today's categories sorted by duration desc */
    categoriesToday: CategoryStat[];
    /** ISO timestamp of computation */
    generatedAt: string;
};
