"use client";

import { useEffect } from "react";

export type HotkeyBindings = Readonly<Record<string, () => void>>;

// Dashboard-local keydown hotkeys only -- no global OS hooks, browser
// keydown listener on `window`. Ignored while the user is typing in an
// input/textarea/select/contentEditable element, EXCEPT "Escape" (which
// should still dismiss an overlay even if focus is sitting in a field).
// Modifier combos (Cmd/Ctrl/Alt) are left alone so browser/OS shortcuts
// never get hijacked.
export function useHotkeys(bindings: HotkeyBindings, enabled = true): void {
    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }

            const target = event.target;
            const isTyping =
                target instanceof HTMLElement &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.tagName === "SELECT" ||
                    target.isContentEditable);
            if (isTyping && event.key !== "Escape") {
                return;
            }

            const action = bindings[event.key] ?? bindings[event.key.toLowerCase()];
            if (!action) return;

            event.preventDefault();
            action();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [bindings, enabled]);
}
