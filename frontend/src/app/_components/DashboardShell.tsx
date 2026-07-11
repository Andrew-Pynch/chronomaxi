"use client";

import { useConvexConnectionState, useQuery } from "convex/react";
import { Panel } from "~/components/nerv";
import { api } from "~/lib/convexApi";
import { PanelFocusProvider } from "~/lib/hotkeys/panelFocus";
import { useDeviceFilter } from "~/lib/useDeviceFilter";
import { DashboardContent } from "./DashboardContent";

export const DashboardShell = () => {
    const deviceFilter = useDeviceFilter();
    const data = useQuery(api.dashboard.getDashboard, { device: deviceFilter.device });
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
        <PanelFocusProvider>
            <DashboardContent
                data={data}
                connected={connection.isWebSocketConnected}
                deviceFilter={deviceFilter}
            />
        </PanelFocusProvider>
    );
};
