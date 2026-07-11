import { NextResponse, type NextRequest } from "next/server";
import { env } from "~/env";
import { parseTailnetMap, resolveDeviceFromForwardedFor } from "~/lib/tailnet-map";

// Auto-defaults the dashboard's device filter: the reverse proxy in front of
// this app sets X-Forwarded-For to the requester's tailnet IP, which we map
// to a canonical device name via CHRONOMAXI_TAILNET_MAP ("ip=name,ip=name").
// No map entry (or no env var set at all) -> device: null, and the client
// falls back to the "ALL" filter. Never throws on a malformed header or
// missing env -- an unrecognized caller is just an unfiltered dashboard, not
// an error.
export function GET(request: NextRequest) {
    const map = parseTailnetMap(env.CHRONOMAXI_TAILNET_MAP);
    const device = resolveDeviceFromForwardedFor(
        request.headers.get("x-forwarded-for"),
        map,
    );

    return NextResponse.json({ device });
}
