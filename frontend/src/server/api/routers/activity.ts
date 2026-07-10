import { getActivityDataForCurrentUser } from "~/app/home/actions";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const activityRouter = createTRPCRouter({
    getAll: publicProcedure.query(async ({}) => {
        return await getActivityDataForCurrentUser();
    }),
});
