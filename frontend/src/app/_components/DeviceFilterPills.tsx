"use client";

import { ALL_DEVICES, buildDeviceCycle, type DeviceFilterValue } from "~/lib/device-filter";
import { cn } from "~/lib/utils";

type DeviceFilterPillsProps = {
    devices: readonly string[];
    value: DeviceFilterValue;
    onChange: (value: DeviceFilterValue) => void;
    autoDetected: string | null;
    className?: string;
};

export const DeviceFilterPills = ({
    devices,
    value,
    onChange,
    autoDetected,
    className,
}: DeviceFilterPillsProps) => {
    const options = buildDeviceCycle(devices);
    const autoValue = autoDetected ?? ALL_DEVICES;
    const isOverride = value !== autoValue;

    return (
        <div className={cn("flex flex-wrap items-center gap-3", className)}>
            <div
                role="group"
                aria-label="Device filter"
                className="flex flex-wrap items-center gap-2"
            >
                {options.map((option) => {
                    const active = option === value;
                    return (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onChange(option)}
                            className={cn(
                                "border px-3 py-1.5 font-body text-2xs uppercase tracking-nerv transition-colors duration-150 ease-nerv",
                                active
                                    ? "border-primary bg-primary text-fg-inverse"
                                    : "border-grid-strong text-fg-2 hover:border-primary hover:text-primary",
                            )}
                        >
                            {option}
                        </button>
                    );
                })}
            </div>
            <p className="font-body text-2xs uppercase tracking-nerv text-fg-muted">
                {isOverride
                    ? autoDetected
                        ? `manual override // auto-detected ${autoDetected}`
                        : "manual override"
                    : autoDetected
                      ? `auto-detected // ${autoDetected}`
                      : "no auto-detection for this host"}
            </p>
        </div>
    );
};
