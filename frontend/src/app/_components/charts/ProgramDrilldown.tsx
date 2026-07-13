"use client";

import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { useQuery } from "convex/react";
import { api } from "~/lib/convexApi";
import { AXIS_TICK, GRID_STROKE } from "./chart-style";
import { ChartTooltip } from "./ChartTooltip";
import { seriesColor } from "./category-colors";

const ROW_HEIGHT_PX = 34;
const MIN_HEIGHT_PX = 120;

type ProgramDrilldownProps = {
    program: string;
    dayKey: string;
    device?: string;
    onCollapse: () => void;
};

// Sub-context breakdown for one program+day(+device). Terminal spans use tmux
// sessions when captured, with foreground commands as a historical fallback;
// non-terminal spans fall back to title clusters when browserTitle exists.
export const ProgramDrilldown = ({
    program,
    dayKey,
    device,
    onCollapse,
}: ProgramDrilldownProps) => {
    const detail = useQuery(api.dashboard.getProgramDetail, { program, dayKey, device });

    return (
        <div className="mt-4 border-t border-grid-line pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate font-display text-xs uppercase tracking-nerv-wide text-primary">
                        {program}
                    </p>
                    <p className="font-jp text-2xs text-fg-muted">
                        {detail === undefined ? "サブプロセス内訳" : `内訳: ${detail.contextLabel}`}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onCollapse}
                    aria-label="Back to programs list"
                    className="shrink-0 border border-grid-strong px-2 py-1 font-body text-2xs uppercase tracking-nerv text-fg-2 transition-colors duration-150 ease-nerv hover:border-primary hover:text-primary focus:border-primary focus:text-primary focus:outline-none"
                >
                    Back
                </button>
            </div>

            {detail === undefined ? (
                <DrilldownSkeleton />
            ) : (
                <div className="space-y-3">
                    {detail.captureGap ? (
                        <p className="border border-grid-line bg-bg-1/70 px-3 py-2 font-body text-2xs uppercase tracking-nerv text-fg-muted">
                            {detail.captureGap}
                        </p>
                    ) : null}
                    {detail.subContexts.length === 0 ? (
                        <p className="border border-dashed border-grid-strong px-3 py-6 text-center font-body text-2xs uppercase tracking-nerv text-fg-muted">
                            No {detail.contextLabel} breakdown recorded for this window
                        </p>
                    ) : (
                        <ResponsiveContainer
                            width="100%"
                            height={Math.max(
                                MIN_HEIGHT_PX,
                                detail.subContexts.length * ROW_HEIGHT_PX,
                            )}
                        >
                            <BarChart
                                data={detail.subContexts.map((subContext) => ({
                                    subContext: subContext.label,
                                    durationHours: Number(subContext.durationHours.toFixed(2)),
                                    formattedDuration: subContext.formattedDuration,
                                }))}
                                layout="vertical"
                                margin={{ left: 8, right: 28, top: 4, bottom: 4 }}
                            >
                                <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
                                <XAxis
                                    type="number"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={AXIS_TICK}
                                />
                                <YAxis
                                    dataKey="subContext"
                                    type="category"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={AXIS_TICK}
                                    width={110}
                                />
                                <Tooltip
                                    content={<ChartTooltip />}
                                    cursor={{ fill: "var(--grid-line)" }}
                                />
                                <Bar
                                    dataKey="durationHours"
                                    name="duration"
                                    fill={seriesColor(1)}
                                    radius={[0, 2, 2, 0]}
                                    maxBarSize={18}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            )}
        </div>
    );
};

const DrilldownSkeleton = () => (
    <div className="space-y-2" aria-hidden>
        {[72, 54, 38].map((widthPercent, index) => (
            <div
                key={index}
                className="h-6 animate-nerv-pulse bg-grid-line"
                style={{ width: `${widthPercent}%` }}
            />
        ))}
    </div>
);
