// Category colors per wiki/pages/design-system.md "Dashboard adaptation
// rules": Coding=primary, Research=secondary, Communication=status-info,
// Entertainment=tertiary, Other=fg-muted. Anything outside that taxonomy
// (future categories) falls back to the generic chart series order.
const KNOWN_CATEGORY_COLOR: Record<string, string> = {
    Coding: "var(--primary)",
    Research: "var(--secondary)",
    Communication: "var(--status-info)",
    Entertainment: "var(--tertiary)",
    Other: "var(--fg-muted)",
};

// Generic recharts series order per wiki/pages/design-system.md ("Charts
// (recharts): series order --primary, --secondary, --tertiary,
// --status-caution, --status-info"). Exported for any chart that needs a
// theme-consistent per-series palette without semantic category names
// (e.g. DevicesChart's one-series-per-device stack).
export const CHART_SERIES_COLORS = [
    "var(--primary)",
    "var(--secondary)",
    "var(--tertiary)",
    "var(--status-caution)",
    "var(--status-info)",
];

export const seriesColor = (index: number): string =>
    CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length] ?? "var(--fg-muted)";

export const categoryColor = (category: string, fallbackIndex: number): string =>
    KNOWN_CATEGORY_COLOR[category] ?? seriesColor(fallbackIndex);
