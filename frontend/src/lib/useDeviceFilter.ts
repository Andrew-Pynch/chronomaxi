"use client";

import { useCallback, useEffect, useState } from "react";
import {
    ALL_DEVICES,
    readStoredDeviceFilter,
    writeStoredDeviceFilter,
    type DeviceFilterValue,
} from "./device-filter";

type WhoamiResponse = { device: string | null };

export type UseDeviceFilterResult = {
    /** Query arg for getDashboard: undefined means "every device" (ALL). */
    device: string | undefined;
    /** Raw pill/state value, including the "ALL" sentinel. */
    filterValue: DeviceFilterValue;
    setFilterValue: (value: DeviceFilterValue) => void;
    /** Device /api/whoami resolved for this client, before any override. */
    autoDetected: string | null;
    /** True once localStorage/whoami resolution has settled. */
    resolved: boolean;
};

// Resolution order per the frontend-wave contract: a localStorage override
// wins outright; otherwise fetch /api/whoami ONCE and default to its
// device. Only an explicit pill click (setFilterValue) ever writes to
// localStorage -- the whoami-driven default is never persisted, so a
// caller whose tailnet mapping later changes (or who never gets one) isn't
// stuck on a stale auto-pick.
export function useDeviceFilter(): UseDeviceFilterResult {
    const [filterValue, setFilterValueState] = useState<DeviceFilterValue>(ALL_DEVICES);
    const [autoDetected, setAutoDetected] = useState<string | null>(null);
    const [resolved, setResolved] = useState(false);

    useEffect(() => {
        const stored = readStoredDeviceFilter();
        if (stored) {
            setFilterValueState(stored);
            setResolved(true);
            return;
        }

        let cancelled = false;
        fetch("/api/whoami")
            .then((response) => (response.ok ? (response.json() as Promise<WhoamiResponse>) : null))
            .then((body) => {
                if (cancelled) return;
                const detected = body?.device ?? null;
                setAutoDetected(detected);
                setFilterValueState(detected ?? ALL_DEVICES);
            })
            .catch(() => {
                // whoami unreachable -- fall back silently to ALL, already the initial state
            })
            .finally(() => {
                if (!cancelled) setResolved(true);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const setFilterValue = useCallback((value: DeviceFilterValue) => {
        setFilterValueState(value);
        writeStoredDeviceFilter(value);
    }, []);

    return {
        device: filterValue === ALL_DEVICES ? undefined : filterValue,
        filterValue,
        setFilterValue,
        autoDetected,
        resolved,
    };
}
