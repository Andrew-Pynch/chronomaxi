"use client";

import { useEffect, useState } from "react";
import ActivitySummary from "~/app/_components/ActivitySummary";
import ThemeSwitch from "~/app/_components/ThemeSwitch";
import Timer from "~/app/_components/Timer";
import { api } from "~/trpc/react";
import type { GetActivityData } from "~/lib/activity-types";
import Charts from "./Charts";

type Props = {
    initialData: GetActivityData;
};

const HomePage = ({ initialData }: Props) => {
    const [data, setData] = useState(initialData);
    const { data: activityData } = api.activity.getAll.useQuery(undefined, {
        refetchInterval: 180000,
    });

    useEffect(() => {
        if (activityData) {
            setData(activityData);
        }
    }, [activityData]);

    return (
        <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.18),transparent_34rem),linear-gradient(180deg,#09090b_0%,#0a0a0d_48%,#09090b_100%)] px-4 py-6 text-zinc-100 sm:px-6 lg:px-8 lg:py-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-6">
                <header className="relative overflow-hidden rounded-3xl border border-zinc-800/80 bg-zinc-950/70 p-5 shadow-2xl shadow-black/30 backdrop-blur md:p-7">
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/60 to-transparent" />
                    <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                        <div className="max-w-3xl">
                            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-indigo-300/90">
                                Local activity console
                            </p>
                            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                                chronomaxi
                            </h1>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">
                                Today is {data.today.label}. Review the shape of
                                your working day across programs, categories,
                                and input intensity.
                            </p>
                        </div>
                        <ThemeSwitch />
                    </div>
                </header>

                <ActivitySummary data={data} />

                <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                    <Charts data={data} />
                    <Timer />
                </section>
            </div>
        </main>
    );
};

export default HomePage;
