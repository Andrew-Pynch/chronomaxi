// Shared presentational formatting for dashboard stat readouts and charts.
// Pure functions only -- no React, no Convex, safe for client and server.

const numberFormatter = new Intl.NumberFormat("en-US");

export const formatCount = (value: number): string =>
    numberFormatter.format(Math.round(Number.isFinite(value) ? value : 0));

export const formatHours = (totalHours: number): string => {
    const safeHours = Number.isFinite(totalHours) ? Math.max(totalHours, 0) : 0;
    const hours = Math.floor(safeHours);
    const minutes = Math.round((safeHours - hours) * 60);

    if (hours === 0) {
        return `${minutes}m`;
    }

    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
};

export const formatMeters = (meters: number): string =>
    `${(Number.isFinite(meters) ? Math.max(meters, 0) : 0).toFixed(1)}m`;

export const formatPercent = (value: number): string =>
    `${(Number.isFinite(value) ? Math.max(value, 0) : 0).toFixed(0)}%`;

export const average = (values: number[]): number => {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((total, value) => total + value, 0) / values.length;
};

/** Delta line vs. a 7-day baseline, e.g. "+1h 12m vs 7d avg" or "-42 vs 7d avg". */
export const formatDelta = (
    value: number,
    baseline: number,
    unit: "hours" | "count" | "meters",
): string => {
    if (!Number.isFinite(baseline) || baseline <= 0) {
        return "no 7d baseline";
    }

    const delta = value - baseline;
    const sign = delta >= 0 ? "+" : "-";
    const magnitude =
        unit === "hours"
            ? formatHours(Math.abs(delta))
            : unit === "meters"
              ? formatMeters(Math.abs(delta))
              : formatCount(Math.abs(delta));

    return `${sign}${magnitude} vs 7d avg`;
};

export const isAllZero = (values: number[]): boolean =>
    values.every((value) => !Number.isFinite(value) || value <= 0);

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** "just now" / "12s ago" / "4m ago" / "3h ago" / "2d ago", relative to
 * `nowMs`. Used for sshSessions "started" column -- always past tense, a
 * future timestamp (clock skew) clamps to "just now" rather than going
 * negative. */
export const formatRelativeTime = (timestampMs: number, nowMs: number): string => {
    const elapsedMs = nowMs - timestampMs;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 1000) {
        return "just now";
    }
    if (elapsedMs < MS_PER_MINUTE) {
        return `${Math.floor(elapsedMs / MS_PER_SECOND)}s ago`;
    }
    if (elapsedMs < MS_PER_HOUR) {
        return `${Math.floor(elapsedMs / MS_PER_MINUTE)}m ago`;
    }
    if (elapsedMs < MS_PER_DAY) {
        return `${Math.floor(elapsedMs / MS_PER_HOUR)}h ago`;
    }
    return `${Math.floor(elapsedMs / MS_PER_DAY)}d ago`;
};

/** "42s" / "5m" / "2h 14m" -- session/timer durations given in ms. */
export const formatDurationMs = (durationMs: number): string => {
    const safeMs = Number.isFinite(durationMs) ? Math.max(durationMs, 0) : 0;
    if (safeMs < MS_PER_MINUTE) {
        return `${Math.round(safeMs / MS_PER_SECOND)}s`;
    }
    const totalMinutes = Math.floor(safeMs / MS_PER_MINUTE);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes.toString().padStart(2, "0")}m` : `${minutes}m`;
};
