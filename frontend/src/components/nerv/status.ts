// Shared status vocabulary for StatusBadge and AlertBanner. Colors resolve
// through CSS custom properties so they follow the active data-theme swap.

export type Status = "ok" | "caution" | "danger" | "info" | "idle";

export const STATUS_COLOR: Record<Status, string> = {
    ok: "var(--status-ok)",
    caution: "var(--status-caution)",
    danger: "var(--status-danger)",
    info: "var(--status-info)",
    idle: "var(--fg-muted)",
};
