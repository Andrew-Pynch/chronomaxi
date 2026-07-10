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

const FALLBACK_SERIES = [
    "var(--primary)",
    "var(--secondary)",
    "var(--tertiary)",
    "var(--status-caution)",
    "var(--status-info)",
];

export const categoryColor = (category: string, fallbackIndex: number): string =>
    KNOWN_CATEGORY_COLOR[category] ??
    FALLBACK_SERIES[fallbackIndex % FALLBACK_SERIES.length] ??
    "var(--fg-muted)";
