"use client";

import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import type { GetActivityData } from "~/lib/activity-types";

type Props = {
    data: GetActivityData;
};

type TooltipPayload = {
    name?: string;
    value?: number | string;
    color?: string;
    payload?: {
        formattedDuration?: string;
        percentage?: number;
        durationHours?: number;
    };
};

type ChartTooltipProps = {
    active?: boolean;
    label?: string;
    payload?: TooltipPayload[];
};

const palette = ["#818cf8", "#a78bfa", "#34d399", "#22d3ee", "#f59e0b"];
const axisStyle = { fontSize: 11, fill: "#71717a" };

const numberFormatter = new Intl.NumberFormat("en-US");

const formatHours = (hours: number) => {
    const safeHours = Number.isFinite(hours) ? Math.max(hours, 0) : 0;
    const wholeHours = Math.floor(safeHours);
    const minutes = Math.round((safeHours - wholeHours) * 60);

    if (wholeHours === 0) {
        return `${minutes}m`;
    }

    return `${wholeHours}h ${minutes.toString().padStart(2, "0")}m`;
};

const isAllZero = (values: number[]) =>
    values.every((value) => !Number.isFinite(value) || value <= 0);

const EmptyState = () => (
    <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-zinc-800 text-sm text-zinc-500">
        no activity yet
    </div>
);

const ChartCard = ({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) => (
    <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 shadow-xl shadow-black/20 backdrop-blur">
        <h2 className="mb-4 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-zinc-500">
            {title}
        </h2>
        {children}
    </article>
);

const ChartTooltip = ({ active, label, payload }: ChartTooltipProps) => {
    if (!active || !payload?.length) {
        return null;
    }

    return (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/95 px-3 py-2 text-xs shadow-2xl shadow-black/50">
            {label ? (
                <p className="mb-2 font-medium text-zinc-300">{label}</p>
            ) : null}
            <div className="space-y-1.5">
                {payload.map((item) => {
                    const value =
                        typeof item.value === "number"
                            ? numberFormatter.format(item.value)
                            : item.value;
                    const formattedDuration = item.payload?.formattedDuration;
                    const percentage = item.payload?.percentage;

                    return (
                        <div
                            key={`${item.name ?? "value"}-${value ?? "empty"}`}
                            className="flex min-w-40 items-center justify-between gap-4"
                        >
                            <span className="flex items-center gap-2 text-zinc-500">
                                <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: item.color }}
                                />
                                {item.name ?? "value"}
                            </span>
                            <span className="font-medium text-zinc-100">
                                {formattedDuration ??
                                    (typeof percentage === "number"
                                        ? `${percentage.toFixed(0)}%`
                                        : value)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const Charts = ({ data }: Props) => {
    const dailyHours = data.days.map((day) => ({
        label: day.label,
        totalHours: Number(day.totalHours.toFixed(2)),
        formattedDuration: formatHours(day.totalHours),
    }));
    const hourlyKeystrokes = data.hourlyToday.map((hour) => ({
        label: hour.label,
        keystrokes: hour.keystrokes,
    }));
    const programs = data.programsToday.slice(0, 8).map((program) => ({
        program: program.program,
        durationHours: Number(program.durationHours.toFixed(2)),
        formattedDuration: program.formattedDuration,
    }));
    const categories = data.categoriesToday.filter(
        (category) => category.durationHours > 0 || category.percentage > 0,
    );

    return (
        <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard title="Active hours, last 7 days">
                {isAllZero(dailyHours.map((day) => day.totalHours)) ? (
                    <EmptyState />
                ) : (
                    <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={dailyHours} margin={{ left: 0, right: 4 }}>
                            <defs>
                                <linearGradient id="hoursGradient" x1="0" x2="0" y1="0" y2="1">
                                    <stop offset="0%" stopColor="#818cf8" stopOpacity={0.36} />
                                    <stop offset="100%" stopColor="#818cf8" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid stroke="#ffffff" strokeOpacity={0.08} vertical={false} />
                            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisStyle} dy={8} />
                            <YAxis axisLine={false} tickLine={false} tick={axisStyle} width={34} />
                            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#818cf8", strokeOpacity: 0.25 }} />
                            <Area
                                type="monotone"
                                dataKey="totalHours"
                                name="active time"
                                stroke="#818cf8"
                                strokeWidth={2}
                                fill="url(#hoursGradient)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </ChartCard>

            <ChartCard title="Keystrokes per hour today">
                {isAllZero(hourlyKeystrokes.map((hour) => hour.keystrokes)) ? (
                    <EmptyState />
                ) : (
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={hourlyKeystrokes} margin={{ left: 0, right: 4 }}>
                            <CartesianGrid stroke="#ffffff" strokeOpacity={0.08} vertical={false} />
                            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisStyle} interval={2} dy={8} />
                            <YAxis axisLine={false} tickLine={false} tick={axisStyle} width={42} />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(129, 140, 248, 0.08)" }} />
                            <Bar dataKey="keystrokes" name="keystrokes" fill="#34d399" radius={[6, 6, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </ChartCard>

            <ChartCard title="Programs today">
                {programs.length === 0 || isAllZero(programs.map((program) => program.durationHours)) ? (
                    <EmptyState />
                ) : (
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart
                            data={programs}
                            layout="vertical"
                            margin={{ left: 8, right: 28, top: 4, bottom: 4 }}
                        >
                            <CartesianGrid stroke="#ffffff" strokeOpacity={0.08} horizontal={false} />
                            <XAxis type="number" axisLine={false} tickLine={false} tick={axisStyle} />
                            <YAxis
                                dataKey="program"
                                type="category"
                                axisLine={false}
                                tickLine={false}
                                tick={axisStyle}
                                width={86}
                            />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(129, 140, 248, 0.08)" }} />
                            <Bar dataKey="durationHours" name="duration" fill="#a78bfa" radius={[0, 8, 8, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </ChartCard>

            <ChartCard title="Categories today">
                {categories.length === 0 || isAllZero(categories.map((category) => category.percentage)) ? (
                    <EmptyState />
                ) : (
                    <div className="grid min-h-[280px] items-center gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
                        <ResponsiveContainer width="100%" height={260}>
                            <PieChart>
                                <Pie
                                    data={categories}
                                    dataKey="durationHours"
                                    nameKey="category"
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={62}
                                    outerRadius={96}
                                    paddingAngle={3}
                                    stroke="rgba(9,9,11,0.9)"
                                    strokeWidth={4}
                                >
                                    {categories.map((category, index) => (
                                        <Cell
                                            key={category.category}
                                            fill={palette[index % palette.length]}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip content={<ChartTooltip />} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-3">
                            {categories.map((category, index) => (
                                <div key={category.category} className="flex items-center justify-between gap-3 text-sm">
                                    <span className="flex min-w-0 items-center gap-2 text-zinc-400">
                                        <span
                                            className="h-2.5 w-2.5 rounded-full"
                                            style={{ backgroundColor: palette[index % palette.length] }}
                                        />
                                        <span className="truncate">{category.category}</span>
                                    </span>
                                    <span className="font-medium text-zinc-100">
                                        {category.percentage.toFixed(0)}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </ChartCard>
        </div>
    );
};

export default Charts;
