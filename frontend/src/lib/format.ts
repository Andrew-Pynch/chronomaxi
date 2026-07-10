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
