"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

const ThemeSwitch = () => {
    const [mounted, setMounted] = useState(false);
    const { resolvedTheme, setTheme } = useTheme();

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <div className="h-10 w-10 rounded-full border border-zinc-800 bg-zinc-900/70" />
        );
    }

    const isDark = resolvedTheme !== "light";

    return (
        <button
            type="button"
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-300 shadow-lg shadow-black/20 transition hover:border-zinc-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        >
            {isDark ? (
                <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M20.2 14.7A8 8 0 0 1 9.3 3.8 8.5 8.5 0 1 0 20.2 14.7Z"
                    />
                </svg>
            ) : (
                <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                >
                    <circle cx="12" cy="12" r="3.8" />
                    <path
                        strokeLinecap="round"
                        d="M12 2.5v2.2m0 14.6v2.2m9.5-9.5h-2.2M4.7 12H2.5m16.2-6.7-1.6 1.6M6.9 17.1l-1.6 1.6m13.4 0-1.6-1.6M6.9 6.9 5.3 5.3"
                    />
                </svg>
            )}
        </button>
    );
};

export default ThemeSwitch;
