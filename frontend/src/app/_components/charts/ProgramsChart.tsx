"use client";

import { useState } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import type { BarProps } from "recharts";
import type { ActiveShape } from "recharts/types/util/types";
import { Panel } from "~/components/nerv";
import type { DashboardData } from "~/lib/activity-types";
import { isAllZero } from "~/lib/format";
import { AXIS_TICK, GRID_STROKE } from "./chart-style";
import { ChartTooltip } from "./ChartTooltip";
import { EmptyChart } from "./EmptyChart";
import { ProgramDrilldown } from "./ProgramDrilldown";

type Props = {
    data: DashboardData;
    /** Currently active device filter -- narrows the drill-down query the
     * same way it narrows every other series on the dashboard. */
    device?: string;
};

// What recharts actually hands a Bar's `shape` render prop at runtime
// (x/y/width/height/fill/payload) is materially narrower than its own
// declared `BarProps["shape"]` type, which is why the cast at the bottom
// of this file exists.
type ProgramBarShapeProps = {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    fill?: string;
    payload?: { program: string };
};

type ClickableProgramBarProps = ProgramBarShapeProps & {
    selectedProgram: string | null;
    onSelect: (program: string) => void;
};

const ClickableProgramBar = ({
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    fill,
    payload,
    selectedProgram,
    onSelect,
}: ClickableProgramBarProps) => {
    const program = payload?.program;
    if (!program) return null;
    const selected = program === selectedProgram;

    return (
        <g
            tabIndex={0}
            role="button"
            aria-label={`Show sub-process detail for ${program}`}
            aria-pressed={selected}
            onClick={() => onSelect(program)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(program);
                }
            }}
            style={{ cursor: "pointer", outline: "none" }}
        >
            <rect x={x} y={y} width={width} height={height} fill={fill} />
            {selected ? (
                <rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth={2}
                />
            ) : null}
        </g>
    );
};

export const ProgramsChart = ({ data, device }: Props) => {
    const [expandedProgram, setExpandedProgram] = useState<string | null>(null);

    const series = data.programsToday.slice(0, 8).map((program) => ({
        program: program.program,
        durationHours: Number(program.durationHours.toFixed(2)),
        formattedDuration: program.formattedDuration,
    }));

    const toggleProgram = (program: string) => {
        setExpandedProgram((current) => (current === program ? null : program));
    };

    // recharts' declared `shape` type doesn't line up with the plain
    // x/y/width/height/fill/payload object it hands the render function at
    // runtime -- cast once here (assigned to a named const, per project
    // convention for unchecked library-boundary casts) rather than fighting
    // the library's types at the JSX call site.
    const renderBar: ActiveShape<BarProps, SVGPathElement> = ((props: ProgramBarShapeProps) => (
        <ClickableProgramBar
            {...props}
            selectedProgram={expandedProgram}
            onSelect={toggleProgram}
        />
    )) as unknown as ActiveShape<BarProps, SVGPathElement>;

    return (
        <Panel title="Programs today" titleJp="本日のプログラム" id="PANEL-103">
            {series.length === 0 ||
            isAllZero(series.map((program) => program.durationHours)) ? (
                <EmptyChart />
            ) : (
                <>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart
                            data={series}
                            layout="vertical"
                            margin={{ left: 8, right: 28, top: 4, bottom: 4 }}
                        >
                            <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
                            <XAxis
                                type="number"
                                axisLine={false}
                                tickLine={false}
                                tick={AXIS_TICK}
                            />
                            <YAxis
                                dataKey="program"
                                type="category"
                                axisLine={false}
                                tickLine={false}
                                tick={AXIS_TICK}
                                width={90}
                            />
                            <Tooltip
                                content={<ChartTooltip />}
                                cursor={{ fill: "var(--grid-line)" }}
                            />
                            <Bar
                                dataKey="durationHours"
                                name="duration"
                                fill="var(--tertiary)"
                                radius={[0, 2, 2, 0]}
                                maxBarSize={22}
                                shape={renderBar}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                    <p className="mt-2 font-body text-2xs uppercase tracking-nerv text-fg-muted">
                        Click or press Enter on a bar for a sub-process breakdown
                    </p>
                    {expandedProgram ? (
                        <ProgramDrilldown
                            program={expandedProgram}
                            dayKey={data.today.date}
                            device={device}
                            onCollapse={() => setExpandedProgram(null)}
                        />
                    ) : null}
                </>
            )}
        </Panel>
    );
};
