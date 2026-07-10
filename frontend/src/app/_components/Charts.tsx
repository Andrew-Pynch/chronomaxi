import type { DashboardData } from "~/lib/activity-types";
import { ActiveHoursChart } from "./charts/ActiveHoursChart";
import { CategoriesChart } from "./charts/CategoriesChart";
import { KeystrokesChart } from "./charts/KeystrokesChart";
import { ProgramsChart } from "./charts/ProgramsChart";

type ChartsProps = {
    data: DashboardData;
};

export const Charts = ({ data }: ChartsProps) => (
    <div className="grid gap-4 xl:grid-cols-2">
        <ActiveHoursChart data={data} />
        <KeystrokesChart data={data} />
        <ProgramsChart data={data} />
        <CategoriesChart data={data} />
    </div>
);
