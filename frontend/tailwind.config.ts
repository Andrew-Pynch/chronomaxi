import { type Config } from "tailwindcss";

export default {
    content: ["./src/**/*.tsx"],
    darkMode: ["class"],
    theme: {
        colors: {
            transparent: "transparent",
            current: "currentColor",
            void: "var(--bg-void)",
            canvas: "var(--bg-base)",
            surface: "var(--bg-surface)",
            elevated: "var(--bg-elevated)",
            overlay: "var(--bg-overlay)",
            "fg-1": "var(--fg1)",
            "fg-2": "var(--fg2)",
            "fg-muted": "var(--fg-muted)",
            "fg-inverse": "var(--fg-inverse)",
            primary: {
                DEFAULT: "var(--primary)",
                muted: "var(--primary-muted)",
                glow: "var(--primary-glow)",
            },
            secondary: {
                DEFAULT: "var(--secondary)",
                muted: "var(--secondary-muted)",
                glow: "var(--secondary-glow)",
            },
            tertiary: {
                DEFAULT: "var(--tertiary)",
                muted: "var(--tertiary-muted)",
            },
            danger: {
                DEFAULT: "var(--status-danger)",
                dark: "var(--status-danger-dark)",
            },
            caution: "var(--status-caution)",
            ok: "var(--status-ok)",
            info: "var(--status-info)",
            "grid-line": "var(--grid-line)",
            "grid-strong": "var(--grid-strong)",
            "grid-tick": "var(--grid-tick)",
            "grid-axis": "var(--grid-axis)",
            hazard: {
                "ok-a": "var(--hazard-ok-a)",
                "ok-b": "var(--hazard-ok-b)",
                "danger-a": "var(--hazard-danger-a)",
                "danger-b": "var(--hazard-danger-b)",
            },
        },
        extend: {
            fontFamily: {
                display: ["var(--font-display)"],
                body: ["var(--font-body)"],
                data: ["var(--font-data)"],
                "data-alt": ["var(--font-data-alt)"],
                jp: ["var(--font-jp)"],
            },
            fontSize: {
                "2xs": ["10px", { lineHeight: "1.4" }],
                xs: ["12px", { lineHeight: "1.4" }],
                sm: ["14px", { lineHeight: "1.5" }],
                base: ["16px", { lineHeight: "1.5" }],
                lg: ["20px", { lineHeight: "1.4" }],
                xl: ["28px", { lineHeight: "1.3" }],
                data: ["32px", { lineHeight: "1.1" }],
                mega: ["48px", { lineHeight: "1" }],
            },
            letterSpacing: {
                "nerv-tight": "var(--track-tight)",
                "nerv-body": "var(--track-body)",
                nerv: "var(--track-label)",
                "nerv-wide": "var(--track-display)",
            },
            borderRadius: {
                none: "var(--radius-none)",
                sm: "var(--radius-sm)",
                DEFAULT: "var(--radius-sm)",
                md: "var(--radius-md)",
                full: "9999px",
            },
            borderWidth: {
                3: "3px",
            },
            transitionTimingFunction: {
                nerv: "cubic-bezier(0.22, 1, 0.36, 1)",
            },
            animation: {
                "nerv-pulse": "nerv-pulse var(--duration-pulse) ease-in-out infinite",
                "nerv-pulse-dot":
                    "nerv-pulse-dot var(--duration-pulse) ease-in-out infinite",
                "nerv-blink": "nerv-blink var(--duration-blink) step-end infinite",
                "nerv-cascade": "nerv-cascade var(--duration-cascade) var(--ease-nerv) both",
                "nerv-flicker": "nerv-flicker var(--duration-flicker) ease-in-out",
            },
        },
    },
    plugins: [],
} satisfies Config;
