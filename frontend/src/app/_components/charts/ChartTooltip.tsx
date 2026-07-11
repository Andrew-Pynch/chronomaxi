import { formatCount, formatPercent } from "~/lib/format";

type TooltipPayloadEntry = {
    name?: string;
    value?: number | string;
    color?: string;
    payload?: {
        formattedDuration?: string;
        percentage?: number;
    };
};

export type ChartTooltipProps = {
    active?: boolean;
    label?: string;
    payload?: TooltipPayloadEntry[];
    /** Overrides how a numeric entry.value renders when the payload has no
     * per-row `formattedDuration`/`percentage` (e.g. a multi-series stacked
     * chart where every series needs its own unit, not a shared count). */
    valueFormatter?: (value: number, entry: TooltipPayloadEntry) => string;
};

export const ChartTooltip = ({
    active,
    label,
    payload,
    valueFormatter,
}: ChartTooltipProps) => {
    if (!active || !payload?.length) {
        return null;
    }

    return (
        <div
            className="border border-grid-strong bg-elevated px-3 py-2 text-xs"
            style={{ borderRadius: "2px" }}
        >
            {label ? (
                <p className="mb-2 font-body uppercase tracking-nerv text-fg-2">
                    {label}
                </p>
            ) : null}
            <div className="space-y-1.5">
                {payload.map((entry) => {
                    const value =
                        typeof entry.value === "number"
                            ? (valueFormatter?.(entry.value, entry) ?? formatCount(entry.value))
                            : entry.value;
                    const formattedDuration = entry.payload?.formattedDuration;
                    const percentage = entry.payload?.percentage;

                    return (
                        <div
                            key={`${entry.name ?? "value"}-${String(value ?? "empty")}`}
                            className="flex min-w-40 items-center justify-between gap-4"
                        >
                            <span className="flex items-center gap-2 text-fg-2">
                                <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: entry.color }}
                                />
                                {entry.name ?? "value"}
                            </span>
                            <span className="font-data text-fg-1">
                                {formattedDuration ??
                                    (typeof percentage === "number"
                                        ? formatPercent(percentage)
                                        : value)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
