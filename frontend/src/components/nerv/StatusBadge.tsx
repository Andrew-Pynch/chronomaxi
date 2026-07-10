import { cn } from "~/lib/utils";
import { STATUS_COLOR, type Status } from "./status";

type StatusBadgeProps = {
    status: Status;
    label: string;
    labelJp?: string;
    /** Defaults to true for every status except "idle". */
    pulse?: boolean;
    className?: string;
};

export const StatusBadge = ({
    status,
    label,
    labelJp,
    pulse,
    className,
}: StatusBadgeProps) => {
    const color = STATUS_COLOR[status];
    const shouldPulse = pulse ?? status !== "idle";

    return (
        <div
            className={cn(
                "inline-flex items-center gap-2 border px-2 py-1",
                className,
            )}
            style={{ borderColor: color, color }}
        >
            <span
                className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    shouldPulse && "animate-nerv-pulse-dot",
                )}
                style={{ backgroundColor: color }}
            />
            <span className="font-body text-2xs uppercase tracking-nerv">
                {label}
            </span>
            {labelJp ? (
                <span className="font-jp text-2xs opacity-80">{labelJp}</span>
            ) : null}
        </div>
    );
};
