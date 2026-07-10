"use client";

import { useConvexConnectionState, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { AlertBanner, Panel } from "~/components/nerv";
import { Charts } from "./Charts";
import { DashboardHeader } from "./DashboardHeader";
import { StatRow } from "./StatRow";
import Timer from "./Timer";

export const DashboardShell = () => {
    const data = useQuery(api.dashboard.getDashboard);
    const connection = useConvexConnectionState();

    if (!data) {
        return (
            <main className="nerv-grid min-h-screen px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
                <div className="mx-auto max-w-7xl">
                    <Panel title="Booting" titleJp="起動中" id="PANEL-000">
                        <p className="font-body text-sm text-fg-2">
                            Awaiting telemetry from the chronomaxi backend...
                        </p>
                    </Panel>
                </div>
            </main>
        );
    }

    return (
        <main className="nerv-grid min-h-screen px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-4">
                <DashboardHeader
                    todayLabel={data.today.label}
                    connected={connection.isWebSocketConnected}
                />
                {connection.isWebSocketConnected ? null : (
                    <AlertBanner
                        status="danger"
                        label="LINK LOST"
                        labelJp="断絶"
                        message="Connection to the chronomaxi backend was lost. Displayed data may be stale."
                    />
                )}
                <StatRow data={data} />
                <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                    <Charts data={data} />
                    <Timer />
                </section>
            </div>
        </main>
    );
};
