// Data-driven device-identity resolution, per ConvexFoundation: "Don't
// hardcode the table since it's meant to be editable without a redeploy."
// internal.deviceAliases.list() is queried once at importer startup and the
// {alias -> canonicalDevice} map is held in memory for the rest of the run
// (aliases never change mid-import). Any deviceName with no matching row
// falls back to identity (canonical === raw), so an unmapped or future device
// never crashes the importer -- it just imports under its own name until an
// operator adds a deviceAliases row for it. The raw value is always preserved
// on the span (rawDeviceName), so this resolution step is purely additive; it
// never discards information.

import type { ConvexHttpClient } from "convex/browser";
import { fn } from "./convex-client";

interface DeviceAliasRow {
    alias: string;
    canonicalDevice: string;
    note?: string;
}

function isDeviceAliasRow(value: unknown): value is DeviceAliasRow {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return typeof v.alias === "string" && typeof v.canonicalDevice === "string";
}

export class DeviceAliasResolver {
    private readonly aliasToCanonical: Record<string, string>;

    private constructor(aliasToCanonical: Record<string, string>) {
        this.aliasToCanonical = aliasToCanonical;
    }

    static async load(client: ConvexHttpClient): Promise<DeviceAliasResolver> {
        const rows: unknown = await client.query(fn.listDeviceAliases, {});
        if (!Array.isArray(rows)) {
            throw new Error(`deviceAliases.list returned a non-array: ${JSON.stringify(rows)}`);
        }
        const map: Record<string, string> = {};
        for (const row of rows) {
            if (!isDeviceAliasRow(row)) {
                throw new Error(`deviceAliases.list returned an unexpected row shape: ${JSON.stringify(row)}`);
            }
            map[row.alias] = row.canonicalDevice;
        }
        return new DeviceAliasResolver(map);
    }

    resolve(rawDeviceName: string): string {
        return this.aliasToCanonical[rawDeviceName] ?? rawDeviceName;
    }
}
