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
import { Panel } from "~/components/nerv";
import type { DashboardData } from "~/lib/activity-types";
import { isAllZero } from "~/lib/format";
import { AXIS_TICK, GRID_STROKE } from "./chart-style";
import { ChartTooltip } from "./ChartTooltip";
import { EmptyChart } from "./EmptyChart";

type Props = {
    data: DashboardData;
};

// Old spans never recorded a keystroke count (the input-count signal was
// added later), so an all-zero keystrokes series doesn't necessarily mean
// an idle day -- it means we're blind to input counts for that window.
// hourlyToday.activeMinutes (totalDurationMs/60000, tracked from span
// coverage regardless of input-count support) is a strictly older, more
// reliable activity signal, so it's the fallback rather than a second
// empty state. Only when BOTH signals are all-zero is the hour genuinely
// idle.
export const KeystrokesChart = ({ data }: Props) => {
    const keystrokeSeries = data.hourlyToday.map((hour) => ({
        label: hour.label,
        keystrokes: hour.keystrokes,
    }));
    const activeMinuteSeries = data.hourlyToday.map((hour) => ({
        label: hour.label,
        activeMinutes: Number(hour.activeMinutes.toFixed(1)),
    }));

    const keystrokesAllZero = isAllZero(keystrokeSeries.map((hour) => hour.keystrokes));
    const activeMinutesAllZero = isAllZero(
        activeMinuteSeries.map((hour) => hour.activeMinutes),
    );
    const showFallback = keystrokesAllZero && !activeMinutesAllZero;

    return (
        <Panel
            title="Keystrokes per hour today"
            titleJp="本日の時間別打鍵数"
            id="PANEL-102"
        >
            {keystrokesAllZero && activeMinutesAllZero ? (
                <EmptyChart />
            ) : (
                <>
                    {showFallback ? (
                        <p className="mb-2 font-body text-2xs uppercase tracking-nerv text-fg-muted">
                            Input counts unavailable — showing active minutes
                        </p>
                    ) : null}
                    <ResponsiveContainer width="100%" height={showFallback ? 236 : 260}>
                        <BarChart
                            data={showFallback ? activeMinuteSeries : keystrokeSeries}
                            margin={{ left: 0, right: 4 }}
                        >
                            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                            <XAxis
                                dataKey="label"
                                axisLine={false}
                                tickLine={false}
                                tick={AXIS_TICK}
                                interval={2}
                                dy={8}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={AXIS_TICK}
                                width={42}
                            />
                            <Tooltip
                                content={<ChartTooltip />}
                                cursor={{ fill: "var(--grid-line)" }}
                            />
                            <Bar
                                dataKey={showFallback ? "activeMinutes" : "keystrokes"}
                                name={showFallback ? "active minutes" : "keystrokes"}
                                fill={showFallback ? "var(--status-info)" : "var(--secondary)"}
                                radius={[2, 2, 0, 0]}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </>
            )}
        </Panel>
    );
};
