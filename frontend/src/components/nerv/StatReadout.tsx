import { cn } from "~/lib/utils";

type Tone = "primary" | "secondary" | "tertiary" | "fg1";

const TONE_CLASS: Record<Tone, string> = {
    primary: "text-primary",
    secondary: "text-secondary",
    tertiary: "text-tertiary",
    fg1: "text-fg-1",
};

type StatReadoutProps = {
    label: string;
    labelJp?: string;
    value: string;
    /** Delta/context line under the value, e.g. "+1h 12m vs 7d avg" */
    delta?: string;
    tone?: Tone;
    className?: string;
};

export const StatReadout = ({
    label,
    labelJp,
    value,
    delta,
    tone = "primary",
    className,
}: StatReadoutProps) => (
    <div className={cn("flex flex-col gap-2", className)}>
        <div>
            {labelJp ? (
                <p className="font-jp text-2xs text-fg-2">{labelJp}</p>
            ) : null}
            <p className="font-body text-2xs uppercase tracking-nerv text-fg-2">
                {label}
            </p>
        </div>
        <p
            className={cn(
                "truncate font-data text-data tabular-nums",
                TONE_CLASS[tone],
            )}
        >
            {value}
        </p>
        {delta ? (
            <p className="truncate font-body text-2xs text-fg-muted">{delta}</p>
        ) : null}
    </div>
);
