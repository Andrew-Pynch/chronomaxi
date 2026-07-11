// Device filter state shared by DeviceFilterPills, the "d" hotkey, and
// DashboardShell's getDashboard subscription. "ALL" is the sentinel for "no
// device arg" (getDashboard sums across every device when device is
// omitted); any other value is passed through as-is as the query's
// `device` arg.

export const ALL_DEVICES = "ALL";

export type DeviceFilterValue = string;

export const DEVICE_FILTER_STORAGE_KEY = "chronomaxi-device-filter";

// The only three hosts that will ever report to chronomaxi (see
// skill://tailnet) -- fixed cycle order for the "d" hotkey and the pill
// row's default ordering, per the frontend-wave contract
// ("ALL -> big-ron -> big-bertha -> lil-timmy -> ALL"). Any device Convex
// reports that ISN'T one of these (a future host, or a raw pre-alias name)
// still shows up, appended alphabetically after the canonical three, so the
// filter never silently hides real data.
const CANONICAL_DEVICE_ORDER = ["big-ron", "big-bertha", "lil-timmy"] as const;

/** ALL first, then every device Convex reports, canonical hosts in their
 * fixed order followed by anything unrecognized (alphabetical). Reused for
 * both the pill row's render order and the "d" hotkey's cycle so the two
 * never drift apart. */
export const buildDeviceCycle = (devices: readonly string[]): DeviceFilterValue[] => {
    const known = CANONICAL_DEVICE_ORDER.filter((device) => devices.includes(device));
    const extra = devices
        .filter((device) => !(CANONICAL_DEVICE_ORDER as readonly string[]).includes(device))
        .slice()
        .sort((a, b) => a.localeCompare(b));
    return [ALL_DEVICES, ...known, ...extra];
};

export const readStoredDeviceFilter = (): DeviceFilterValue | null => {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage.getItem(DEVICE_FILTER_STORAGE_KEY);
    } catch {
        return null; // private browsing / storage disabled
    }
};

export const writeStoredDeviceFilter = (value: DeviceFilterValue): void => {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(DEVICE_FILTER_STORAGE_KEY, value);
    } catch {
        // ignore -- an unpersisted override just resets on next load
    }
};
