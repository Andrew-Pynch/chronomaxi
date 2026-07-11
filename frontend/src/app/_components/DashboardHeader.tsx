import { StatusBadge } from "~/components/nerv";
import { ThemeSwitcher } from "./ThemeSwitcher";

export type ActiveOverride = {
    deviceName: string;
    actor: string;
};

type DashboardHeaderProps = {
    todayLabel: string;
    connected: boolean;
    /** Devices with an active actorOverride row (api.actorOverride.get) --
     * every span ingested for that device is being attributed to `actor`
     * regardless of who's actually at the keyboard. */
    activeOverrides: ActiveOverride[];
};

export const DashboardHeader = ({
    todayLabel,
    connected,
    activeOverrides,
}: DashboardHeaderProps) => (
    <header className="relative border border-grid-strong bg-surface px-5 py-5 md:px-7 md:py-6">
        <div className="nerv-hazard absolute inset-x-0 top-0" />
        <div className="flex flex-col gap-5 pt-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
                <p className="font-body text-2xs uppercase tracking-nerv-wide text-fg-muted">
                    PYNCH
                </p>
                <h1 className="mt-1 font-display text-xl uppercase tracking-nerv-wide text-primary sm:text-mega">
                    CHRONOMAXI
                </h1>
                <div className="mt-2 flex flex-wrap items-baseline gap-2">
                    <p className="font-body text-xs uppercase tracking-nerv text-fg-2">
                        Activity observation terminal
                    </p>
                    <p className="font-jp text-2xs text-fg-muted">活動観測端末</p>
                </div>
                <p className="mt-3 font-data text-2xs text-fg-muted">
                    LOCAL DAY // {todayLabel}
                </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
                <ThemeSwitcher />
                {activeOverrides.map((override) => (
                    <StatusBadge
                        key={override.deviceName}
                        status="caution"
                        label={`${override.deviceName.toUpperCase()} OVERRIDE: ${override.actor.toUpperCase()}`}
                        labelJp="上書き中"
                    />
                ))}
                <StatusBadge
                    status={connected ? "ok" : "danger"}
                    label={connected ? "SYSTEM NOMINAL" : "LINK LOST"}
                    labelJp={connected ? "正常" : "断絶"}
                />
            </div>
        </div>
    </header>
);
