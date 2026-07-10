import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export type DataTableColumn<T> = {
    key: string;
    header: string;
    headerJp?: string;
    align?: "left" | "right" | "center";
    render: (row: T) => ReactNode;
};

type DataTableProps<T> = {
    columns: DataTableColumn<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    emptyMessage?: string;
    className?: string;
};

const ALIGN_CLASS = {
    left: "text-left",
    right: "text-right",
    center: "text-center",
} as const;

export function DataTable<T>({
    columns,
    rows,
    rowKey,
    emptyMessage = "no data",
    className,
}: DataTableProps<T>) {
    if (rows.length === 0) {
        return (
            <p className="px-3 py-6 text-center font-body text-2xs uppercase tracking-nerv text-fg-muted">
                {emptyMessage}
            </p>
        );
    }

    return (
        <table className={cn("w-full border-collapse text-sm", className)}>
            <thead>
                <tr>
                    {columns.map((column) => (
                        <th
                            key={column.key}
                            className={cn(
                                "border-b border-grid-strong px-3 py-2 font-data text-2xs uppercase tracking-nerv text-primary",
                                ALIGN_CLASS[column.align ?? "left"],
                            )}
                        >
                            {column.header}
                            {column.headerJp ? (
                                <span className="ml-1 font-jp normal-case text-fg-2">
                                    {column.headerJp}
                                </span>
                            ) : null}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr
                        key={rowKey(row)}
                        className="border-b border-grid-line last:border-b-0"
                    >
                        {columns.map((column) => (
                            <td
                                key={column.key}
                                className={cn(
                                    "px-3 py-2 text-fg-1",
                                    ALIGN_CLASS[column.align ?? "left"],
                                )}
                            >
                                {column.render(row)}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
