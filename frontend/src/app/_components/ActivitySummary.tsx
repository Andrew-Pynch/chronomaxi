"use client";

import type { GetActivityData } from "~/lib/activity-types";

type Props = {
    data: GetActivityData;
};

type StatCard = {
    label: string;
    value: string;
    context: string;
    tone: string;
};

const numberFormatter = new Intl.NumberFormat("en-US");

const formatDuration = (totalHours: number) => {
    const safeHours = Number.isFinite(totalHours) ? Math.max(totalHours, 0) : 0;
    const hours = Math.floor(safeHours);
    const minutes = Math.round((safeHours - hours) * 60);

    if (hours === 0) {
        return `${minutes}m`;
    }

    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
};

const formatDelta = (value: number, average: number, unit: string) => {
    if (!Number.isFinite(average) || average <= 0) {
        return "no 7d baseline";
    }

    const delta = value - average;
    const sign = delta >= 0 ? "+" : "-";
    const formattedDelta =
        unit === "h"
            ? formatDuration(Math.abs(delta))
            : numberFormatter.format(Math.round(Math.abs(delta)));

    return `${sign}${formattedDelta} vs 7d avg`;
};

const average = (values: number[]) => {
    if (values.length === 0) {
        return 0;
    }

    return values.reduce((total, value) => total + value, 0) / values.length;
};

const ActivitySummary = ({ data }: Props) => {
    const clickTotal =
        data.today.leftClickCount +
        data.today.rightClickCount +
        data.today.middleClickCount;
    const topProgram = data.programsToday[0]?.program ?? "No program yet";
    const topCategory = data.categoriesToday[0]?.category ?? "No category yet";

    const sevenDayHours = average(data.days.map((day) => day.totalHours));
    const sevenDayKeystrokes = average(data.days.map((day) => day.keystrokes));
    const sevenDayClicks = average(
        data.days.map(
            (day) =>
                day.leftClickCount + day.rightClickCount + day.middleClickCount,
        ),
    );
    const sevenDayMouseMeters = average(
        data.days.map((day) => day.mouseMovementInMeters),
    );
    const mouseDelta =
        data.today.mouseMovementInMeters - sevenDayMouseMeters;

    const cards: StatCard[] = [
        {
            label: "Active time today",
            value: formatDuration(data.today.totalHours),
            context: formatDelta(data.today.totalHours, sevenDayHours, "h"),
            tone: "from-indigo-400/25 to-violet-500/10",
        },
        {
            label: "Keystrokes today",
            value: numberFormatter.format(data.today.keystrokes),
            context: formatDelta(data.today.keystrokes, sevenDayKeystrokes, "n"),
            tone: "from-sky-400/20 to-indigo-500/10",
        },
        {
            label: "Clicks today",
            value: numberFormatter.format(clickTotal),
            context: formatDelta(clickTotal, sevenDayClicks, "n"),
            tone: "from-emerald-400/20 to-teal-500/10",
        },
        {
            label: "Mouse distance",
            value: `${data.today.mouseMovementInMeters.toFixed(1)} m`,
            context: `${mouseDelta >= 0 ? "+" : "-"}${Math.abs(mouseDelta).toFixed(1)} m vs 7d avg`,
            tone: "from-cyan-400/20 to-blue-500/10",
        },
        {
            label: "Top program",
            value: topProgram,
            context: data.programsToday[0]?.formattedDuration ?? "no activity yet",
            tone: "from-violet-400/20 to-fuchsia-500/10",
        },
        {
            label: "Top category",
            value: topCategory,
            context: data.categoriesToday[0]
                ? `${data.categoriesToday[0].percentage.toFixed(0)}% of today`
                : "no activity yet",
            tone: "from-amber-400/20 to-orange-500/10",
        },
    ];

    return (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {cards.map((card) => (
                <article
                    key={card.label}
                    className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-xl shadow-black/20 transition duration-200 hover:-translate-y-0.5 hover:border-zinc-700"
                >
                    <div
                        className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${card.tone} opacity-70`}
                    />
                    <div className="relative">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                            {card.label}
                        </p>
                        <p className="mt-3 truncate text-2xl font-semibold tracking-[-0.03em] text-white">
                            {card.value}
                        </p>
                        <p className="mt-2 truncate text-xs text-zinc-500">
                            {card.context}
                        </p>
                    </div>
                </article>
            ))}
        </section>
    );
};

export default ActivitySummary;
