import type { DashboardData } from "~/lib/activity-types";
import { ActiveHoursChart } from "./charts/ActiveHoursChart";
import { CategoriesChart } from "./charts/CategoriesChart";
import { DevicesChart } from "./charts/DevicesChart";
import { KeystrokesChart } from "./charts/KeystrokesChart";
import { ProgramsChart } from "./charts/ProgramsChart";
import { FocusablePanel } from "./FocusablePanel";

type ChartsProps = {
    data: DashboardData;
    /** Active device filter, passed through to ProgramsChart's drill-down
     * query so it narrows the same way every other series does. */
    device?: string;
};

export const Charts = ({ data, device }: ChartsProps) => (
    <div className="grid gap-4 xl:grid-cols-2">
        <FocusablePanel panelId="active-hours">
            <ActiveHoursChart data={data} />
        </FocusablePanel>
        <FocusablePanel panelId="keystrokes">
            <KeystrokesChart data={data} />
        </FocusablePanel>
        <FocusablePanel panelId="programs">
            <ProgramsChart data={data} device={device} />
        </FocusablePanel>
        <FocusablePanel panelId="categories">
            <CategoriesChart data={data} />
        </FocusablePanel>
        <FocusablePanel panelId="devices" className="xl:col-span-2">
            <DevicesChart data={data} />
        </FocusablePanel>
    </div>
);
