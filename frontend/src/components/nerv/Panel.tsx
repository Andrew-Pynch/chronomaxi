import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

type PanelHeaderProps = {
    title: string;
    titleJp?: string;
    /** Right-aligned panel id tag, e.g. "PANEL-001" */
    id?: string;
    right?: ReactNode;
    className?: string;
};

export const PanelHeader = ({
    title,
    titleJp,
    id,
    right,
    className,
}: PanelHeaderProps) => (
    <header
        className={cn(
            "relative flex items-start justify-between gap-3 border-b border-grid-line px-4 py-3",
            className,
        )}
    >
        <div className="min-w-0">
            {titleJp ? (
                <p className="truncate font-jp text-2xs text-fg-2">{titleJp}</p>
            ) : null}
            <h2 className="truncate font-display text-xs uppercase tracking-nerv-wide text-primary">
                {title}
            </h2>
        </div>
        <div className="flex shrink-0 items-center gap-3">
            {right}
            {id ? (
                <span className="font-data text-2xs text-fg-muted">{id}</span>
            ) : null}
        </div>
    </header>
);

const CornerGlyphs = () => (
    <>
        <span
            aria-hidden
            className="pointer-events-none absolute left-1 top-1 select-none font-data text-2xs leading-none text-grid-tick"
        >
            +
        </span>
        <span
            aria-hidden
            className="pointer-events-none absolute right-1 top-1 select-none font-data text-2xs leading-none text-grid-tick"
        >
            +
        </span>
        <span
            aria-hidden
            className="pointer-events-none absolute bottom-1 left-1 select-none font-data text-2xs leading-none text-grid-tick"
        >
            +
        </span>
        <span
            aria-hidden
            className="pointer-events-none absolute bottom-1 right-1 select-none font-data text-2xs leading-none text-grid-tick"
        >
            +
        </span>
    </>
);

type PanelProps = {
    /** EN title; omit to render children without an auto-generated PanelHeader. */
    title?: string;
    titleJp?: string;
    /** Right-aligned panel id tag, e.g. "PANEL-001" */
    id?: string;
    headerRight?: ReactNode;
    /** Hazard stripe footer: "ok" (green/void) or "danger" (red/amber). Omit for none. */
    hazard?: "ok" | "danger";
    className?: string;
    bodyClassName?: string;
    children: ReactNode;
};

export const Panel = ({
    title,
    titleJp,
    id,
    headerRight,
    hazard,
    className,
    bodyClassName,
    children,
}: PanelProps) => (
    <section
        className={cn(
            "relative overflow-hidden border border-grid-strong bg-surface",
            className,
        )}
    >
        <CornerGlyphs />
        {title ? (
            <PanelHeader title={title} titleJp={titleJp} id={id} right={headerRight} />
        ) : null}
        <div className={cn("relative p-4", bodyClassName)}>{children}</div>
        {hazard ? (
            <div className={hazard === "danger" ? "nerv-hazard-danger" : "nerv-hazard"} />
        ) : null}
    </section>
);
