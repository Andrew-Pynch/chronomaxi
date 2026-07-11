// Parses CHRONOMAXI_TAILNET_MAP ("ip=name,ip=name") and resolves a device
// name from an X-Forwarded-For header value. Pure functions, no Next.js/env
// imports, so they're trivially unit-exercisable from a route handler or a
// script without pulling in ~/env's runtime validation.

export type TailnetMap = ReadonlyMap<string, string>;

export const parseTailnetMap = (raw: string | undefined): TailnetMap => {
    const map = new Map<string, string>();
    if (!raw) {
        return map;
    }
    for (const pair of raw.split(",")) {
        const trimmed = pair.trim();
        if (!trimmed) continue;
        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
            continue; // malformed entry ("ip=", "=name", "noequals") -- skip, don't throw
        }
        const ip = trimmed.slice(0, separatorIndex).trim();
        const name = trimmed.slice(separatorIndex + 1).trim();
        if (ip && name) {
            map.set(ip, name);
        }
    }
    return map;
};

// X-Forwarded-For is a comma-separated client-to-proxy chain; the ORIGINAL
// client IP is always the first entry (subsequent entries are proxies the
// request passed through on its way to us).
export const firstForwardedIp = (forwardedFor: string | null): string | null => {
    if (!forwardedFor) return null;
    const first = forwardedFor.split(",")[0]?.trim();
    return first && first.length > 0 ? first : null;
};

export const resolveDeviceFromForwardedFor = (
    forwardedFor: string | null,
    map: TailnetMap,
): string | null => {
    const ip = firstForwardedIp(forwardedFor);
    if (!ip) return null;
    return map.get(ip) ?? null;
};
