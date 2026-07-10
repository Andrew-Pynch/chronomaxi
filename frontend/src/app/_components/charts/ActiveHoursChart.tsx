"use client";

import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { Panel } from "~/components/nerv";
import type { DashboardData } from "~/lib/activity-types";
import { formatHours, isAllZero } from "~/lib/format";
import { AXIS_TICK, GRID_STROKE } from "./chart-style";
import { ChartTooltip } from "./ChartTooltip";
import { EmptyChart } from "./EmptyChart";

type Props = {
    data: DashboardData;
};

export const ActiveHoursChart = ({ data }: Props) => {
    const series = data.days.map((day) => ({
        label: day.label,
        totalHours: Number(day.totalHours.toFixed(2)),
        formattedDuration: formatHours(day.totalHours),
    }));

    return (
        <Panel
            title="Active hours, last 7 days"
            titleJp="過去7日間の稼働時間"
            id="PANEL-101"
        >
            {isAllZero(series.map((day) => day.totalHours)) ? (
                <EmptyChart />
            ) : (
                <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={series} margin={{ left: 0, right: 4 }}>
                        <defs>
                            <linearGradient
                                id="activeHoursFill"
                                x1="0"
                                x2="0"
                                y1="0"
                                y2="1"
                            >
                                <stop
                                    offset="0%"
                                    stopColor="var(--primary)"
                                    stopOpacity={0.32}
                                />
                                <stop
                                    offset="100%"
                                    stopColor="var(--primary)"
                                    stopOpacity={0.02}
                                />
                            </linearGradient>
                        </defs>
                        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                        <XAxis
                            dataKey="label"
                            axisLine={false}
                            tickLine={false}
                            tick={AXIS_TICK}
                            dy={8}
                        />
                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={AXIS_TICK}
                            width={34}
                        />
                        <Tooltip
                            content={<ChartTooltip />}
                            cursor={{ stroke: "var(--primary)", strokeOpacity: 0.25 }}
                        />
                        <Area
                            type="monotone"
                            dataKey="totalHours"
                            name="active time"
                            stroke="var(--primary)"
                            strokeWidth={2}
                            fill="url(#activeHoursFill)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            )}
        </Panel>
    );
};
