"use client";
import React from "react";
import { GetActivityData } from "../home/actions";

type Props = {
    data: GetActivityData;
};
const ActivitySummary = ({ data }: Props) => {
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
                                        {entry.totalHours.toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {entry.keystrokes}
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
