"use client";

import { Panel } from "~/components/nerv";

type Binding = { keys: string; description: string };

const BINDINGS: readonly Binding[] = [
    { keys: "j / k", description: "Cycle panel focus" },
    { keys: "/", description: "Focus the filter input, if one is showing" },
    { keys: "d", description: "Cycle the device filter" },
    { keys: "t", description: "Focus the timer panel" },
    { keys: "?", description: "Toggle this keymap" },
    { keys: "Esc", description: "Close this keymap" },
];

type KeymapOverlayProps = {
    open: boolean;
    onClose: () => void;
};

export const KeymapOverlay = ({ open, onClose }: KeymapOverlayProps) => {
    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-overlay px-4"
            role="dialog"
            aria-modal="true"
            aria-label="Keymap"
            onClick={onClose}
        >
            <div className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
                <Panel title="Keymap" titleJp="キーバインド" id="PANEL-900">
                    <ul className="divide-y divide-grid-line">
                        {BINDINGS.map((binding) => (
                            <li
                                key={binding.keys}
                                className="flex items-center justify-between gap-4 py-2"
                            >
                                <span className="shrink-0 font-data text-xs uppercase tabular-nums tracking-nerv text-primary">
                                    {binding.keys}
                                </span>
                                <span className="text-right font-body text-xs text-fg-2">
                                    {binding.description}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-4 font-body text-2xs uppercase tracking-nerv text-fg-muted">
                        Ignored while typing in an input // Esc or click outside to close
                    </p>
                </Panel>
            </div>
        </div>
    );
};
