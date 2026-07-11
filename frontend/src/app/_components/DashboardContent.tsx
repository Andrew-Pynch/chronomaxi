"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { AlertBanner } from "~/components/nerv";
import type { DashboardData } from "~/lib/activity-types";
import { api } from "~/lib/convexApi";
import { ALL_DEVICES, buildDeviceCycle } from "~/lib/device-filter";
import { usePanelFocus } from "~/lib/hotkeys/panelFocus";
import { useHotkeys, type HotkeyBindings } from "~/lib/hotkeys/useHotkeys";
import type { UseDeviceFilterResult } from "~/lib/useDeviceFilter";
import { Charts } from "./Charts";
import { DashboardHeader, type ActiveOverride } from "./DashboardHeader";
import { DeviceFilterPills } from "./DeviceFilterPills";
import { FocusablePanel } from "./FocusablePanel";
import { KeymapOverlay } from "./KeymapOverlay";
import { SshSessionsPanel } from "./SshSessionsPanel";
import { StatRow } from "./StatRow";
import Timer from "./Timer";

type DashboardContentProps = {
    data: DashboardData;
    connected: boolean;
    deviceFilter: UseDeviceFilterResult;
};

// Mounted only once getDashboard has resolved at least once (DashboardShell
// gates on that), so it's free to own the panel-focus registry, hotkeys,
// and the keymap overlay without juggling a loading state of its own.
export const DashboardContent = ({ data, connected, deviceFilter }: DashboardContentProps) => {
    const { focusNext, focusPrev, focusPanel } = usePanelFocus();
    const [overlayOpen, setOverlayOpen] = useState(false);

    const overrideRows = useQuery(api.actorOverride.get, {});
    const activeOverrides: ActiveOverride[] = (overrideRows ?? [])
        .filter((row) => row.active)
        .map((row) => ({ deviceName: row.deviceName, actor: row.actor }));

    const deviceCycle = useMemo(() => buildDeviceCycle(data.devices), [data.devices]);
    const cycleDevice = useCallback(() => {
        const currentIndex = deviceCycle.indexOf(deviceFilter.filterValue);
        const next = deviceCycle[(currentIndex + 1) % deviceCycle.length] ?? ALL_DEVICES;
        deviceFilter.setFilterValue(next);
    }, [deviceCycle, deviceFilter]);

    const bindings: HotkeyBindings = useMemo(
        () => ({
            "?": () => setOverlayOpen((open) => !open),
            Escape: () => setOverlayOpen(false),
            j: () => {
                if (!overlayOpen) focusNext();
            },
            k: () => {
                if (!overlayOpen) focusPrev();
            },
            // No standalone text filter input exists on this dashboard yet
            // (the device filter is pill buttons, not a text box) -- per
            // the hotkey contract, "/" is a no-op until one does.
            "/": () => {},
            d: () => {
                if (!overlayOpen) cycleDevice();
            },
            t: () => {
                if (!overlayOpen) focusPanel("timer");
            },
        }),
        [overlayOpen, focusNext, focusPrev, cycleDevice, focusPanel],
    );
    useHotkeys(bindings);

    return (
        <main className="nerv-grid min-h-screen px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-4">
                <DashboardHeader
                    todayLabel={data.today.label}
                    connected={connected}
                    activeOverrides={activeOverrides}
                />
                {connected ? null : (
                    <AlertBanner
                        status="danger"
                        label="LINK LOST"
                        labelJp="断絶"
                        message="Connection to the chronomaxi backend was lost. Displayed data may be stale."
                    />
                )}
                <DeviceFilterPills
                    devices={data.devices}
                    value={deviceFilter.filterValue}
                    onChange={deviceFilter.setFilterValue}
                    autoDetected={deviceFilter.autoDetected}
                />
                <StatRow data={data} />
                <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                    <Charts data={data} device={deviceFilter.device} />
                    <FocusablePanel panelId="timer" className="self-start xl:row-span-2">
                        <Timer />
                    </FocusablePanel>
                </section>
                <FocusablePanel panelId="ssh-sessions">
                    <SshSessionsPanel />
                </FocusablePanel>
            </div>
            <KeymapOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} />
        </main>
    );
};
