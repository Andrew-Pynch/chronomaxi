"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { DataTable, Panel, StatusBadge, type DataTableColumn } from "~/components/nerv";
import { api } from "~/lib/convexApi";
import { formatDurationMs, formatRelativeTime } from "~/lib/format";

const RECENT_LIMIT = 20;
const TICK_MS = 30_000;

export type SshSessionRow = FunctionReturnType<typeof api.sshSessions.recent>[number];

const ActorBadge = ({ actor }: { actor: string }) => {
    const isAgent = actor !== "human";
    return (
        <StatusBadge
            status={isAgent ? "caution" : "info"}
            label={isAgent ? actor.toUpperCase() : "HUMAN"}
            pulse={false}
        />
    );
};

const buildColumns = (nowMs: number): DataTableColumn<SshSessionRow>[] => [
    {
        key: "route",
        header: "Route",
        headerJp: "経路",
        render: (row) => (
            <span className="font-data text-xs tabular-nums text-fg-1">
                {row.originHost} <span className="text-fg-muted">{"->"}</span>{" "}
                {row.targetHostAlias ?? row.targetHost}
            </span>
        ),
    },
    {
        key: "actor",
        header: "Actor",
        headerJp: "主体",
        render: (row) => <ActorBadge actor={row.actor} />,
    },
    {
        key: "started",
        header: "Started",
        headerJp: "開始",
        align: "right",
        render: (row) => (
            <span className="font-data text-xs text-fg-2">
                {formatRelativeTime(row.startedAt, nowMs)}
            </span>
        ),
    },
    {
        key: "duration",
        header: "Duration",
        headerJp: "経過",
        align: "right",
        render: (row) =>
            row.endedAt === undefined ? (
                <StatusBadge status="ok" label="LIVE" />
            ) : (
                <span className="font-data text-xs tabular-nums text-fg-1">
                    {formatDurationMs(row.durationMs ?? row.endedAt - row.startedAt)}
                </span>
            ),
    },
];

// Recent SSH lifecycle events (deploy/attribution/README.md) -- every row
// is either still LIVE (no endedAt yet) or complete with a durationMs. The
// "started" column re-renders on a slow tick so relative timestamps age
// without needing a fresh subscription push.
export const SshSessionsPanel = () => {
    const sessions = useQuery(api.sshSessions.recent, { limit: RECENT_LIMIT });
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        const interval = setInterval(() => setNowMs(Date.now()), TICK_MS);
        return () => clearInterval(interval);
    }, []);

    return (
        <Panel title="SSH sessions" titleJp="SSH セッション" id="PANEL-301">
            {sessions === undefined ? (
                <p className="px-1 py-6 font-body text-2xs uppercase tracking-nerv text-fg-muted">
                    Loading recent sessions...
                </p>
            ) : (
                <DataTable
                    columns={buildColumns(nowMs)}
                    rows={sessions}
                    rowKey={(row) => row.sessionId}
                    emptyMessage="no ssh sessions recorded yet"
                />
            )}
        </Panel>
    );
};
