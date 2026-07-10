"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { DataTable, Panel, type DataTableColumn } from "~/components/nerv";
import type { CategoryStat, DashboardData } from "~/lib/activity-types";
import { formatHours, formatPercent, isAllZero } from "~/lib/format";
import { categoryColor } from "./category-colors";
import { ChartTooltip } from "./ChartTooltip";
import { EmptyChart } from "./EmptyChart";

type Props = {
    data: DashboardData;
};

const columns: DataTableColumn<CategoryStat>[] = [
    {
        key: "category",
        header: "Category",
        headerJp: "分類",
        render: (row) => row.category,
    },
    {
        key: "duration",
        header: "Time",
        headerJp: "時間",
        align: "right",
        render: (row) => formatHours(row.durationHours),
    },
    {
        key: "share",
        header: "Share",
        headerJp: "割合",
        align: "right",
        render: (row) => formatPercent(row.percentage),
    },
    {
        key: "agent",
        header: "Agent",
        headerJp: "エージェント",
        align: "right",
        render: (row) => (row.agentHours > 0 ? formatHours(row.agentHours) : "-"),
    },
];

export const CategoriesChart = ({ data }: Props) => {
    const categories = data.categoriesToday.filter(
        (category) => category.durationHours > 0 || category.percentage > 0,
    );

    return (
        <Panel title="Categories today" titleJp="本日の分類" id="PANEL-104">
            {categories.length === 0 ||
            isAllZero(categories.map((category) => category.percentage)) ? (
                <EmptyChart />
            ) : (
                <div className="grid min-h-[260px] items-center gap-4 md:grid-cols-[minmax(0,1fr)_1fr]">
                    <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                            <Pie
                                data={categories}
                                dataKey="durationHours"
                                nameKey="category"
                                cx="50%"
                                cy="50%"
                                innerRadius={58}
                                outerRadius={92}
                                paddingAngle={2}
                                stroke="var(--bg-surface)"
                                strokeWidth={3}
                            >
                                {categories.map((category, index) => (
                                    <Cell
                                        key={category.category}
                                        fill={categoryColor(category.category, index)}
                                    />
                                ))}
                            </Pie>
                            <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                    </ResponsiveContainer>
                    <DataTable
                        columns={columns}
                        rows={categories}
                        rowKey={(row) => row.category}
                    />
                </div>
            )}
        </Panel>
    );
};
