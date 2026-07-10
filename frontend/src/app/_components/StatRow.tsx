import { Panel, StatReadout } from "~/components/nerv";
import type { DashboardData } from "~/lib/activity-types";
import {
    average,
    formatCount,
    formatDelta,
    formatHours,
    formatMeters,
    formatPercent,
} from "~/lib/format";

type StatRowProps = {
    data: DashboardData;
};

export const StatRow = ({ data }: StatRowProps) => {
    const clicksToday =
        data.today.leftClickCount +
        data.today.rightClickCount +
        data.today.middleClickCount;
    const clicksAvg = average(
        data.days.map(
            (day) =>
                day.leftClickCount + day.rightClickCount + day.middleClickCount,
        ),
    );
    const hoursAvg = average(data.days.map((day) => day.totalHours));
    const keystrokesAvg = average(data.days.map((day) => day.keystrokes));
    const mouseAvg = average(data.days.map((day) => day.mouseMovementInMeters));

    const topProgram = data.programsToday[0];
    const topCategory = data.categoriesToday[0];

    return (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Panel>
                <StatReadout
                    label="Active time today"
                    labelJp="本日稼働時間"
                    value={formatHours(data.today.totalHours)}
                    delta={formatDelta(data.today.totalHours, hoursAvg, "hours")}
                    tone="primary"
                />
            </Panel>
            <Panel>
                <StatReadout
                    label="Keystrokes"
                    labelJp="打鍵数"
                    value={formatCount(data.today.keystrokes)}
                    delta={formatDelta(data.today.keystrokes, keystrokesAvg, "count")}
                    tone="secondary"
                />
            </Panel>
            <Panel>
                <StatReadout
                    label="Clicks"
                    labelJp="クリック数"
                    value={formatCount(clicksToday)}
                    delta={formatDelta(clicksToday, clicksAvg, "count")}
                    tone="secondary"
                />
            </Panel>
            <Panel>
                <StatReadout
                    label="Mouse distance"
                    labelJp="マウス移動距離"
                    value={formatMeters(data.today.mouseMovementInMeters)}
                    delta={formatDelta(
                        data.today.mouseMovementInMeters,
                        mouseAvg,
                        "meters",
                    )}
                    tone="secondary"
                />
            </Panel>
            <Panel>
                <StatReadout
                    label="Top program"
                    labelJp="首位プログラム"
                    value={topProgram?.program ?? "NO DATA"}
                    delta={topProgram?.formattedDuration ?? "no activity yet"}
                    tone="tertiary"
                />
            </Panel>
            <Panel>
                <StatReadout
                    label="Top category"
                    labelJp="首位分類"
                    value={topCategory?.category ?? "NO DATA"}
                    delta={
                        topCategory
                            ? `${formatPercent(topCategory.percentage)} of today`
                            : "no activity yet"
                    }
                    tone="tertiary"
                />
            </Panel>
        </section>
    );
};
