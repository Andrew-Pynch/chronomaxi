"use client";

import { type ReactNode } from "react";
import { usePanelFocus, type PanelId } from "~/lib/hotkeys/panelFocus";
import { cn } from "~/lib/utils";

type FocusablePanelProps = {
    panelId: PanelId;
    children: ReactNode;
    className?: string;
};

// Registers a panel with the j/k focus cycle and renders the NERV focus
// ring (2px --primary box-shadow, sharp corners) when the registry marks
// this panel as focused. Renders a plain wrapping div rather than
// `display: contents` specifically so the ring has a box to paint on.
export const FocusablePanel = ({ panelId, children, className }: FocusablePanelProps) => {
    const { registerPanel, isPanelFocused } = usePanelFocus();
    const focused = isPanelFocused(panelId);

    return (
        <div
            ref={(node) => registerPanel(panelId, node)}
            tabIndex={-1}
            data-panel-id={panelId}
            className={cn("outline-none", className)}
            style={{
                boxShadow: focused ? "0 0 0 2px var(--primary)" : "0 0 0 2px transparent",
                transition: "box-shadow 150ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
        >
            {children}
        </div>
    );
};
