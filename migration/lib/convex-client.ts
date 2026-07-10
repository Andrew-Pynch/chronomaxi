// Thin wrapper around the self-hosted Convex admin client. Uses
// makeFunctionReference (convex/server) rather than generated codegen types,
// since migration/ is a standalone bun package that intentionally does not
// depend on the frontend's convex/_generated output -- keeping this package
// buildable/runnable on its own, from any checkout that has the two SQLite
// sources and network access to the deployment. Internal functions
// (importSpanBatch, get/setImportCheckpoint, deviceAliases.list) require
// admin auth to invoke from outside another Convex function; that is the
// whole point of gating bulk import behind the admin key rather than the
// public HTTP /ingest route.

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import type { SpanImportInput } from "./batch-writer";

type ImportSpanBatchArgs = Record<string, unknown> & {
    spans: SpanImportInput[];
    importBatch: string;
};
interface ImportSpanBatchResult {
    inserted: number;
    skipped: number;
}

type GetImportCheckpointArgs = Record<string, unknown> & {
    source: string;
};

type SetImportCheckpointArgs = Record<string, unknown> & {
    source: string;
    lastSourceRowid: number;
    lastSourceLogId?: string;
    spansWritten: number;
    status: "running" | "complete" | "failed";
    importBatch: string;
};

interface DeviceAliasRow {
    alias: string;
    canonicalDevice: string;
    note?: string;
}

export function createAdminClient(): ConvexHttpClient {
    const url = process.env.CONVEX_SELF_HOSTED_URL;
    const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY;
    if (!url) {
        throw new Error("CONVEX_SELF_HOSTED_URL is not set (export it or put it in migration/.env.local)");
    }
    if (!adminKey) {
        throw new Error("CONVEX_SELF_HOSTED_ADMIN_KEY is not set (export it or put it in migration/.env.local)");
    }
    const client = new ConvexHttpClient(url, { skipConvexDeploymentUrlCheck: true });
    // setAdminAuth is real at runtime (see node_modules/convex/dist/esm/browser/http_client.js
    // -- sends `Authorization: Convex <token>`, the exact mechanism the self-hosted CLI and
    // BACKUP-RUNBOOK.md's CONVEX_SELF_HOSTED_ADMIN_KEY workflows rely on) but is marked
    // @internal and omitted from the published .d.ts, so the public ConvexHttpClient type has
    // no declared method for it. This is a deliberate, sanctioned self-hosted-admin use case, not
    // a hack around an intentional restriction.
    const withAdminAuth = client as unknown as { setAdminAuth: (token: string) => void };
    withAdminAuth.setAdminAuth(adminKey);
    return client;
}

export const fn = {
    importSpanBatch: makeFunctionReference<"mutation", ImportSpanBatchArgs, ImportSpanBatchResult>(
        "migration:importSpanBatch"
    ),
    getImportCheckpoint: makeFunctionReference<
        "query",
        GetImportCheckpointArgs,
        Omit<SetImportCheckpointArgs, "source"> | null
    >("migration:getImportCheckpoint"),
    setImportCheckpoint: makeFunctionReference<"mutation", SetImportCheckpointArgs, null>(
        "migration:setImportCheckpoint"
    ),
    listDeviceAliases: makeFunctionReference<"query", Record<string, never>, DeviceAliasRow[]>(
        "deviceAliases:list"
    ),
} satisfies Record<string, FunctionReference<"query" | "mutation">>;
