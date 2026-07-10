import { Suspense } from "react";
import { getActivityDataForCurrentUser } from "./actions";
import HomePage from "./_components/HomePage";

// revalidate every 10 seconds
export const revalidate = 10;

const Home = async () => {
    const data = await getActivityDataForCurrentUser();

    if (!data) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-400">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-6 py-5 text-sm shadow-2xl shadow-black/30">
                    No activity data is available yet.
                </div>
            </main>
        );
    }

    return (
        <Suspense
            fallback={
                <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-400">
                    Loading activity dashboard...
                </main>
            }
        >
            <HomePage initialData={data} />
        </Suspense>
    );
};

export default Home;
