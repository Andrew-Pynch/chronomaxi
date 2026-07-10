import { cn } from "~/lib/utils";
import { STATUS_COLOR, type Status } from "./status";

type AlertBannerProps = {
    status: Status;
    label: string;
    labelJp?: string;
    message: string;
    className?: string;
};

export const AlertBanner = ({
    status,
    label,
    labelJp,
    message,
    className,
}: AlertBannerProps) => {
    const color = STATUS_COLOR[status];

    return (
        <div
            className={cn(
                "flex items-start gap-3 border-l-[3px] bg-surface px-4 py-3",
                className,
            )}
            style={{ borderLeftColor: color }}
        >
            <div className="flex shrink-0 flex-col">
                <span
                    className="font-display text-2xs uppercase tracking-nerv-wide"
                    style={{ color }}
                >
                    {label}
                </span>
                {labelJp ? (
                    <span className="font-jp text-2xs text-fg-2">{labelJp}</span>
                ) : null}
            </div>
            <p className="font-body text-sm text-fg-1">{message}</p>
        </div>
    );
};
