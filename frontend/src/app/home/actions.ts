"use server";
import { revalidatePath } from "next/cache";
import { LogHelpers } from "~/server/api/routers/helpers/logHelpers";
import { db } from "~/server/db";

export type GetActivityData = Awaited<
    ReturnType<typeof getActivityDataForCurrentUser>
>;

export const getActivityDataForCurrentUser = async () => {
    // only last 24 hours
    const showActivityAfterDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

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

    const logStats = LogHelpers.getStatsForLogs(logs);
    return logStats;
};

export const deleteAllActivityData = async () => {
    // await db.programUsage.deleteMany();
    // await db.activityLog.deleteMany();

    revalidatePath("/home");
};
