"use client";

import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { Panel } from "~/components/nerv";
import type { DashboardData } from "~/lib/activity-types";
import { formatHours, isAllZero } from "~/lib/format";
import { seriesColor } from "./category-colors";
import { AXIS_TICK, GRID_STROKE } from "./chart-style";
import { ChartTooltip } from "./ChartTooltip";
import { EmptyChart } from "./EmptyChart";

const MS_PER_HOUR = 3_600_000;

type Props = {
    data: DashboardData;
};

// Pivots getDashboard's flat perDeviceDays rows into one stacked-bar row
// per day, keyed by device name, over the SAME 7-day window as data.days
// (perDeviceDays is never narrowed by the active device filter, unlike
// every other series -- it's meant for exactly this cross-device view).
export const DevicesChart = ({ data }: Props) => {
    const devices = data.devices;
    const hoursByDayAndDevice = new Map<string, Record<string, number>>(
        data.days.map((day) => [day.date, {}]),
    );
    for (const row of data.perDeviceDays) {
        const bucket = hoursByDayAndDevice.get(row.dayKey);
        if (!bucket) continue;
        bucket[row.deviceName] = (bucket[row.deviceName] ?? 0) + row.durationMs / MS_PER_HOUR;
    }

    const series = data.days.map((day) => {
        const bucket = hoursByDayAndDevice.get(day.date) ?? {};
        const row: Record<string, string | number> = { label: day.label };
        for (const device of devices) {
            row[device] = Number((bucket[device] ?? 0).toFixed(2));
        }
        return row;
    });

    const empty =
        devices.length === 0 ||
        isAllZero(series.flatMap((row) => devices.map((device) => Number(row[device] ?? 0))));

    return (
        <Panel
            title="Active hours by machine"
            titleJp="端末別稼働時間"
            id="PANEL-105"
        >
            {empty ? (
                <EmptyChart />
            ) : (
                <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={series} margin={{ left: 0, right: 4, top: 4, bottom: 4 }}>
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
                            content={
                                <ChartTooltip
                                    valueFormatter={(value) => formatHours(value)}
                                />
                            }
                            cursor={{ fill: "var(--grid-line)" }}
                        />
                        <Legend
                            wrapperStyle={{
                                fontFamily: "var(--font-body)",
                                fontSize: "10px",
                                textTransform: "uppercase",
                                letterSpacing: "var(--track-label)",
                                color: "var(--fg-2)",
                            }}
                        />
                        {devices.map((device, index) => (
                            <Bar
                                key={device}
                                dataKey={device}
                                name={device}
                                stackId="devices"
                                fill={seriesColor(index)}
                                maxBarSize={28}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            )}
        </Panel>
    );
};
