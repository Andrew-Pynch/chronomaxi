// Shared contract between the Convex dashboard query (convex/dashboard.ts,
// getDashboard, imported everywhere via ~/lib/convexApi) and the UI. Field
// names/units MUST stay byte-identical to convex/dashboard.ts's validators
// (dailySummaryValidator etc); DashboardData below is also the prop type
// every dashboard child component (StatRow, Charts, DashboardHeader) uses.

export type DailySummary = {
    /** Local date key, e.g. "2026-07-09" (America/Chicago) */
    date: string;
    /** Short display label, e.g. "Wed 7/9" */
    label: string;
    totalHours: number;
    humanHours: number;
    agentHours: number;
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
    humanHours: number;
    agentHours: number;
};

export type HourlyStat = {
    /** 0-23, local time */
    hour: number;
    /** e.g. "14:00" */
    label: string;
    keystrokes: number;
    activeMinutes: number;
    humanMinutes: number;
    agentMinutes: number;
};

export type PerDeviceDay = {
    dayKey: string;
    deviceName: string;
    durationMs: number;
};

export type DashboardData = {
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
    /** IANA timezone used for all bucketing, e.g. "America/Chicago" */
    timezone: string;
    /** Every deviceName with a dayAgg row in the last 7 days, sorted --
     * drives the device filter pills. Never narrowed by `device`. */
    devices: string[];
    /** Full per-device breakdown across the same 7-day window as `days`,
     * regardless of the active `device` filter -- feeds DevicesChart. */
    perDeviceDays: PerDeviceDay[];
};
