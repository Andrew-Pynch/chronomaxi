"use client";

import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
} from "recharts";

import { GetActivityData } from "../actions";

type Props = {
    data: GetActivityData;
};

const Charts = ({ data }: Props) => {
    const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#AF19FF"];

    return (
        <div>
            <h1>Hours of Activity per Day</h1>
            <ResponsiveContainer width="100%" height={400}>
                <LineChart data={data.hoursWorkedPerDay}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line
                        type="monotone"
                        dataKey="hours"
                        stroke="#8884d8"
                        activeDot={{ r: 8 }}
                    />
                </LineChart>
            </ResponsiveContainer>

            <h1>Keystrokes per Day</h1>
            <ResponsiveContainer width="100%" height={400}>
                <LineChart
                    data={Object.entries(data.countKeyStrokesPerDay).map(
                        ([date, count]) => ({ date, count }),
                    )}
                >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line
                        type="monotone"
                        dataKey="count"
                        stroke={"#82ca9d"}
                        activeDot={{ r: 8 }}
                    />
                </LineChart>
            </ResponsiveContainer>

            <h1>Keystroke Frequency per Hour Today</h1>
            <ResponsiveContainer width="100%" height={400}>
                <BarChart
                    data={Object.entries(
                        data.keystrokeFrequencyPerHourToday,
                    ).map(([hour, programData]) => ({
                        ...programData,
                    }))}
                >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    {Object.keys(
                        data.keystrokeFrequencyPerHourToday[0] || {},
                    ).map((program, index) => (
                        <Bar
                            key={program}
                            dataKey={program}
                            stackId="a"
                            fill={COLORS[index % COLORS.length]}
                        />
                    ))}
                </BarChart>
            </ResponsiveContainer>

            <h1>Activity per Program Today</h1>
            <ResponsiveContainer width="100%" height={400}>
                <PieChart>
                    <Pie
                        data={Object.entries(data.acivityPerProgramToday).map(
                            ([program, duration]) => ({ program, duration }),
                        )}
                        dataKey="duration"
                        nameKey="program"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        fill="#8884d8"
                        label
                    >
                        {Object.entries(data.acivityPerProgramToday).map(
                            ([program, duration], index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={COLORS[index % COLORS.length]}
                                />
                            ),
                        )}
                    </Pie>
                    <Tooltip />
                    <Legend />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
};

export default Charts;
