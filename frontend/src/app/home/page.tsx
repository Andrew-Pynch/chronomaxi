import { getActivityDataForCurrentUser } from "./actions";
import { Suspense } from "react";
import ThemeSwitch from "../_components/ThemeSwitch";
import HomePage from "./_components/HomePage";

// revalidate every 10 seconds
export const revalidate = 10;

const Home = async () => {
    const data = await getActivityDataForCurrentUser();

    if (!data) {
        return <div>No data</div>;
    }

    return (
        <div>
            <ThemeSwitch />
            <Suspense fallback={<div>Loading...</div>}>
                <HomePage initialData={data} />
            </Suspense>
        </div>
    );
};

export default Home;
