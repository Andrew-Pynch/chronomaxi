"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

// Deterministic panel order for the "j"/"k" hotkeys -- registration order
// depends on mount timing, not layout, so cycling instead walks this fixed
// list and skips any id that isn't currently mounted.
export const PANEL_ORDER = [
    "active-hours",
    "keystrokes",
    "programs",
    "categories",
    "devices",
    "ssh-sessions",
    "timer",
] as const;

export type PanelId = (typeof PANEL_ORDER)[number];

export type PanelFocusApi = {
    isPanelFocused: (panelId: string) => boolean;
    registerPanel: (panelId: string, node: HTMLElement | null) => void;
    focusNext: () => void;
    focusPrev: () => void;
    focusPanel: (panelId: PanelId) => void;
};

const PanelFocusContext = createContext<PanelFocusApi | null>(null);

export const PanelFocusProvider = ({ children }: { children: ReactNode }) => {
    const nodesRef = useRef(new Map<string, HTMLElement>());
    const [focusedPanelId, setFocusedPanelId] = useState<PanelId | null>(null);

    const registerPanel = useCallback((panelId: string, node: HTMLElement | null) => {
        if (node) {
            nodesRef.current.set(panelId, node);
        } else {
            nodesRef.current.delete(panelId);
        }
    }, []);

    const focusPanel = useCallback((panelId: PanelId) => {
        const node = nodesRef.current.get(panelId);
        if (!node) return;
        node.focus({ preventScroll: true });
        node.scrollIntoView({ behavior: "smooth", block: "nearest" });
        setFocusedPanelId(panelId);
    }, []);

    const cycleFocus = useCallback(
        (direction: 1 | -1) => {
            const mountedOrder = PANEL_ORDER.filter((id) => nodesRef.current.has(id));
            if (mountedOrder.length === 0) return;
            const currentIndex = focusedPanelId ? mountedOrder.indexOf(focusedPanelId) : -1;
            const nextIndex =
                (currentIndex + direction + mountedOrder.length) % mountedOrder.length;
            const nextId = mountedOrder[nextIndex];
            if (nextId) focusPanel(nextId);
        },
        [focusPanel, focusedPanelId],
    );

    const value = useMemo<PanelFocusApi>(
        () => ({
            isPanelFocused: (panelId: string) => focusedPanelId === panelId,
            registerPanel,
            focusNext: () => cycleFocus(1),
            focusPrev: () => cycleFocus(-1),
            focusPanel,
        }),
        [cycleFocus, focusPanel, focusedPanelId, registerPanel],
    );

    return <PanelFocusContext.Provider value={value}>{children}</PanelFocusContext.Provider>;
};

export const usePanelFocus = (): PanelFocusApi => {
    const context = useContext(PanelFocusContext);
    if (!context) {
        throw new Error("usePanelFocus must be used within a PanelFocusProvider");
    }
    return context;
};
