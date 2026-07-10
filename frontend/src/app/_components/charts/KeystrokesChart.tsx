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

export const KeystrokesChart = ({ data }: Props) => {
    const series = data.hourlyToday.map((hour) => ({
        label: hour.label,
        keystrokes: hour.keystrokes,
    }));

    return (
        <Panel
            title="Keystrokes per hour today"
            titleJp="本日の時間別打鍵数"
            id="PANEL-102"
        >
            {isAllZero(series.map((hour) => hour.keystrokes)) ? (
                <EmptyChart />
            ) : (
                <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={series} margin={{ left: 0, right: 4 }}>
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
                            dataKey="keystrokes"
                            name="keystrokes"
                            fill="var(--secondary)"
                            radius={[2, 2, 0, 0]}
                        />
                    </BarChart>
                </ResponsiveContainer>
            )}
        </Panel>
    );
};
