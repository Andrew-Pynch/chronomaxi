"use client";
import React from "react";
import { GetActivityData } from "../home/actions";

type Props = {
    data: GetActivityData;
};

const ActivitySummary = ({ data }: Props) => {
    const formatDuration = (totalHours: number) => {
        const hours = Math.floor(totalHours);
        const minutes = Math.round((totalHours - hours) * 60);
        return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    };

    return (
        <div className="mb-8 w-1/2">
            <h2 className="text-2xl font-bold mb-4">Activity Summary</h2>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                        <tr>
                            <th
                                scope="col"
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                                Date
                            </th>
                            <th
                                scope="col"
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                                Total Hours
                            </th>
                            <th
                                scope="col"
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                                Keystrokes
                            </th>
                            <th
                                scope="col"
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                                Left Clicks
                            </th>
                            <th
                                scope="col"
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                                Right Clicks
                            </th>
                            <th
                                scope="col"
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                                Middle Clicks
                            </th>
                            <th>
                                Mouse Movement in MM
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {data?.summaryData &&
                            Object.values(data.summaryData).map((entry) => (
                                <tr
                                    key={entry.date}
                                    className="hover:bg-gray-500"
                                >
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {entry.date}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {formatDuration(entry.totalHours)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap"> {entry.keystrokes} </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {entry.leftClickCount}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {entry.rightClickCount}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {entry.middleClickCount}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {entry.mouseMovementInInches}
                                    </td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ActivitySummary;
