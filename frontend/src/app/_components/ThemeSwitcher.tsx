"use client";

import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import {
    DEFAULT_THEME,
    THEME_LABELS,
    THEME_STORAGE_KEY,
    THEMES,
    isTheme,
    type Theme,
} from "~/lib/theme";

const nextTheme = (current: Theme): Theme => {
    const index = THEMES.indexOf(current);
    return THEMES[(index + 1) % THEMES.length] ?? DEFAULT_THEME;
};

export const ThemeSwitcher = () => {
    const [mounted, setMounted] = useState(false);
    const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

    useEffect(() => {
        const current = document.documentElement.getAttribute("data-theme");
        setTheme(isTheme(current) ? current : DEFAULT_THEME);
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <div className="h-8 w-32 border border-grid-strong bg-surface" aria-hidden />
        );
    }

    const label = THEME_LABELS[theme];

    return (
        <button
            type="button"
            onClick={() => {
                const next = nextTheme(theme);
                document.documentElement.setAttribute("data-theme", next);
                window.localStorage.setItem(THEME_STORAGE_KEY, next);
                setTheme(next);
            }}
            aria-label={`Switch theme preset (current: ${label.en})`}
            className={cn(
                "inline-flex items-center gap-2 border border-grid-strong bg-surface px-3 py-1.5",
                "font-body text-2xs uppercase tracking-nerv text-fg-2",
                "transition-colors duration-150 ease-nerv hover:border-primary hover:text-primary",
            )}
        >
            <span
                className="h-1.5 w-1.5 rounded-full bg-primary"
                aria-hidden
            />
            {label.en}
            <span className="font-jp normal-case text-fg-muted">{label.jp}</span>
        </button>
    );
};
