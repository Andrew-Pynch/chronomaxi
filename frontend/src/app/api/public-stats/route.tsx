import { getActivityDataForCurrentUser } from "~/app/home/actions";

export async function GET() {
    const activity = await getActivityDataForCurrentUser();

    return new Response(JSON.stringify(activity), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
        },
    });
}
