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

export const ProgramsChart = ({ data }: Props) => {
    const series = data.programsToday.slice(0, 8).map((program) => ({
        program: program.program,
        durationHours: Number(program.durationHours.toFixed(2)),
        formattedDuration: program.formattedDuration,
    }));

    return (
        <Panel title="Programs today" titleJp="本日のプログラム" id="PANEL-103">
            {series.length === 0 ||
            isAllZero(series.map((program) => program.durationHours)) ? (
                <EmptyChart />
            ) : (
                <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                        data={series}
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
                            dataKey="program"
                            type="category"
                            axisLine={false}
                            tickLine={false}
                            tick={AXIS_TICK}
                            width={90}
                        />
                        <Tooltip
                            content={<ChartTooltip />}
                            cursor={{ fill: "var(--grid-line)" }}
                        />
                        <Bar
                            dataKey="durationHours"
                            name="duration"
                            fill="var(--tertiary)"
                            radius={[0, 2, 2, 0]}
                            maxBarSize={22}
                        />
                    </BarChart>
                </ResponsiveContainer>
            )}
        </Panel>
    );
};
