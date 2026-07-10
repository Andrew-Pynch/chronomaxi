"use server";
import { revalidatePath } from "next/cache";
import type { GetActivityData as ActivityData } from "~/lib/activity-types";
import { getStatsForLogs } from "~/server/api/routers/helpers/logHelpers";
import { db } from "~/server/db";

export type { GetActivityData } from "~/lib/activity-types";

export const getActivityDataForCurrentUser = async (): Promise<ActivityData> => {
    const showActivityAfterDate = new Date();
    showActivityAfterDate.setHours(0, 0, 0, 0);
    showActivityAfterDate.setDate(showActivityAfterDate.getDate() - 6);

    const logs = await db.log.findMany({
        where: {
            isIdle: false,
            createdAt: {
                gte: showActivityAfterDate,
            },
        },
        orderBy: {
            createdAt: "asc",
        },
    });

    const logStats = getStatsForLogs(logs);
    return logStats;
};

export const deleteAllActivityData = async () => {
    // await db.programUsage.deleteMany();
    // await db.activityLog.deleteMany();

    revalidatePath("/home");
};
