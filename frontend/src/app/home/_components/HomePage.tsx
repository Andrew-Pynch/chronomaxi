"use client";
import React, { useEffect, useState } from "react";
import { GetActivityData } from "../actions";
import ActivitySummary from "~/app/_components/ActivitySummary";
import Timer from "~/app/_components/Timer";
import Charts from "./Charts";
import { api } from "~/trpc/react";

type Props = {
    initialData: GetActivityData;
};

const HomePage = ({ initialData }: Props) => {
    const [data, setData] = useState(initialData);
    return (
        <div>
            <div className="flex flex-row space-x-4">
                <ActivitySummary data={data} />
                <Timer />
            </div>
            <div>
                <Charts data={data} />
            </div>
        </div>
    );
};

export default HomePage;
