// NERV theme presets. Each swaps only the accent triad via data-theme on
// <html>; see globals.css. Persisted in localStorage under THEME_STORAGE_KEY.

export const THEMES = ["nerv", "magi", "seele", "terminal"] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "nerv";

export const THEME_STORAGE_KEY = "chronomaxi-theme";

export const THEME_LABELS: Record<Theme, { en: string; jp: string }> = {
    nerv: { en: "NERV", jp: "ネルフ" },
    magi: { en: "MAGI", jp: "マギ" },
    seele: { en: "SEELE", jp: "ゼーレ" },
    terminal: { en: "TERMINAL", jp: "端末" },
};

export const isTheme = (value: string | null): value is Theme =>
    value !== null && (THEMES as readonly string[]).includes(value);
