import { getActivityDataForCurrentUser } from "~/app/home/actions";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const activityRouter = createTRPCRouter({
    getAll: protectedProcedure.query(async ({}) => {
        return await getActivityDataForCurrentUser();
    }),
});
