"use server";

import { NextRequest } from "next/server";
import { getActivityDataForCurrentUser } from "~/app/home/actions";

export async function GET(request: NextRequest) {
    const activity = await getActivityDataForCurrentUser();

    console.log("\n\nactivity", activity);

    return new Response(JSON.stringify(activity), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
        },
    });
}
