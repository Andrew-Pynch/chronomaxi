"use server";
import { revalidatePath } from "next/cache";
import { LogHelpers } from "~/server/api/routers/helpers/logHelpers";
import { db } from "~/server/db";

export type GetActivityData = Awaited<
    ReturnType<typeof getActivityDataForCurrentUser>
>;

export const getActivityDataForCurrentUser = async () => {
    // convert 24 hours ago to minutes since epoch
    const currentMinutesSinceEpoch = Math.floor(Date.now() / (60 * 1000));
    const minutesPer24Hours = 24 * 60;
    const showActivityAfterMinutes = currentMinutesSinceEpoch - minutesPer24Hours;

    const logs = await db.log.findMany({
        where: {
            isIdle: false,
            createdAtMinutes: {
                gte: showActivityAfterMinutes,
            },
        },
        orderBy: {
            createdAtMinutes: "asc",
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
