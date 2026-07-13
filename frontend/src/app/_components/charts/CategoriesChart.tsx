"use client";

import { DataTable, Panel, type DataTableColumn } from "~/components/nerv";
import type { CategoryStat, DashboardData } from "~/lib/activity-types";
import { formatHours, formatPercent } from "~/lib/format";
import { categoryColor } from "./category-colors";
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

const DONUT_SIZE = 220;
const DONUT_CENTER = DONUT_SIZE / 2;
const DONUT_RADIUS = 75;
const DONUT_STROKE_WIDTH = 34;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
const FULL_SLICE_EPSILON = 0.000001;

type CategorySlice = CategoryStat & {
    color: string;
    offset: number;
    fraction: number;
    value: number;
};

const categoryValue = (category: CategoryStat) => {
    if (Number.isFinite(category.percentage) && category.percentage > 0) {
        return category.percentage;
    }

    return Number.isFinite(category.durationHours) && category.durationHours > 0
        ? category.durationHours
        : 0;
};

const buildCategorySlices = (categories: CategoryStat[]): CategorySlice[] => {
    const positiveCategories = categories
        .map((category, index) => ({
            ...category,
            color: categoryColor(category.category, index),
            value: categoryValue(category),
        }))
        .filter((category) => category.value > 0);
    const total = positiveCategories.reduce(
        (sum, category) => sum + category.value,
        0,
    );

    if (total <= 0) {
        return [];
    }

    let offset = 0;

    return positiveCategories.map((category) => {
        const fraction = category.value / total;
        const slice = {
            ...category,
            offset,
            fraction,
        };
        offset += fraction * DONUT_CIRCUMFERENCE;
        return slice;
    });
};

const CategoriesDonut = ({ slices }: { slices: CategorySlice[] }) => (
    <svg
        aria-label="Category time distribution"
        className="h-[220px] w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
    >
        {slices.map((slice) => {
            const dashLength = slice.fraction * DONUT_CIRCUMFERENCE;
            const isFullSlice = slice.fraction >= 1 - FULL_SLICE_EPSILON;

            return (
                <circle
                    key={slice.category}
                    cx={DONUT_CENTER}
                    cy={DONUT_CENTER}
                    fill="none"
                    r={DONUT_RADIUS}
                    stroke={slice.color}
                    strokeDasharray={
                        isFullSlice
                            ? undefined
                            : `${dashLength} ${DONUT_CIRCUMFERENCE - dashLength}`
                    }
                    strokeDashoffset={isFullSlice ? undefined : -slice.offset}
                    strokeLinecap="butt"
                    strokeWidth={DONUT_STROKE_WIDTH}
                    style={{
                        transform: "rotate(-90deg)",
                        transformOrigin: "center",
                    }}
                >
                    <title>{`${slice.category}: ${formatPercent(slice.percentage)}`}</title>
                </circle>
            );
        })}
    </svg>
);

export const CategoriesChart = ({ data }: Props) => {
    const categories = data.categoriesToday.filter(
        (category) => categoryValue(category) > 0,
    );
    const slices = buildCategorySlices(categories);
    return (
        <Panel title="Categories today" titleJp="本日の分類" id="PANEL-104">
            {slices.length === 0 ? (
                <EmptyChart />
            ) : (
                <div className="grid min-h-[260px] items-center gap-4 md:grid-cols-[minmax(0,1fr)_1fr]">
                    <CategoriesDonut slices={slices} />
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
