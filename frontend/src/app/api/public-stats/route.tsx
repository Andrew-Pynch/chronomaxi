"use server";

import { NextRequest } from "next/server";
import { getActivityDataForCurrentUser } from "~/app/home/actions";

export async function GET(request: NextRequest) {
    const activity = await getActivityDataForCurrentUser();

    return new Response(JSON.stringify(activity), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
        },
    });
}
