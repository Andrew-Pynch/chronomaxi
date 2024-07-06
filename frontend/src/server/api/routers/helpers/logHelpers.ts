import { Log } from "@prisma/client";

export const LogHelpers = {
    getStatsForLogs: (logs: Log[]) => {
        // per day stats
        const hoursOfActivityPerDay = LogHelpers.getHoursOfActivityPerDay(logs);
        const countKeyStrokesPerDay = LogHelpers.getCountKeyStrokesPerDay(logs);
        const activityPerProgramPerDay =
            LogHelpers.getAcivityPerProgramToday(logs);
        const summaryData = LogHelpers.getSummaryData(logs);
        const summaryDataLast24Hours = LogHelpers.getSummaryDataLast24Hours(logs);
        const hoursWorkedPerDay = LogHelpers.getHoursWorkedPerDay(logs);

        // today stats
        const hoursOfAcitivityToday = LogHelpers.getHoursOfActivityToday(logs);
        const keystrokeFrequencyPerHourToday =
            LogHelpers.getKeystrokeFrequencyPerHourToday(logs);
        const interactionDataLast24Hours =
            LogHelpers.getInteractionDataLast24Hours(logs);
        const acivityPerProgramToday =
            LogHelpers.getAcivityPerProgramToday(logs);
        const categoryPercentages = LogHelpers.getCategoryPercentages(logs);

        return {
            hoursOfActivityPerDay,
            countKeyStrokesPerDay,
            activityPerProgramPerDay,
            hoursOfAcitivityToday,
            interactionDataLast24Hours,
            keystrokeFrequencyPerHourToday,
            acivityPerProgramToday,
            summaryData,
            summaryDataLast24Hours,
            hoursWorkedPerDay,
            categoryPercentages,
        };
    },
    getInteractionDataLast24Hours: (logs: Log[]) => {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const hourlySlices: Record<string, {
            keyPresses: number,
            mouseMovement: number,
            leftClicks: number,
            rightClicks: number,
            middleClicks: number
        }> = {};

        // Initialize hourly slices for the last 24 hours
        for (let i = 0; i < 24; i++) {
            const sliceTime = new Date(now.getTime() - i * 60 * 60 * 1000);
            const sliceKey = sliceTime.toISOString().slice(0, 13); // Format: YYYY-MM-DDTHH
            hourlySlices[sliceKey] = {
                keyPresses: 0,
                mouseMovement: 0,
                leftClicks: 0,
                rightClicks: 0,
                middleClicks: 0
            };
        }

        // Filter logs for the last 24 hours and aggregate data
        logs.filter(log => log.createdAt >= yesterday).forEach(log => {
            const sliceKey = log.createdAt.toISOString().slice(0, 13);
            if (hourlySlices[sliceKey]) {
                hourlySlices[sliceKey]!.keyPresses += log.keysPressedCount || 0;
                hourlySlices[sliceKey]!.mouseMovement += log.mouseMovementInMM || 0;
                hourlySlices[sliceKey]!.leftClicks += log.leftClickCount || 0;
                hourlySlices[sliceKey]!.rightClicks += log.rightClickCount || 0;
                hourlySlices[sliceKey]!.middleClicks += log.middleClickCount || 0;
            }
        });

        // Convert to array, sort by time, and format the time
        const result = Object.entries(hourlySlices)
            .map(([time, data]) => ({
                time: new Date(time).toLocaleTimeString('en-US', { hour: '2-digit', hour12: false }),
                ...data
            }))
            .sort((a, b) => a.time.localeCompare(b.time));

        // Calculate totals
        const totals = result.reduce((acc, hour) => ({
            keyPresses: acc.keyPresses + hour.keyPresses,
            mouseMovement: acc.mouseMovement + hour.mouseMovement,
            leftClicks: acc.leftClicks + hour.leftClicks,
            rightClicks: acc.rightClicks + hour.rightClicks,
            middleClicks: acc.middleClicks + hour.middleClicks
        }), { keyPresses: 0, mouseMovement: 0, leftClicks: 0, rightClicks: 0, middleClicks: 0 });

        console.log('24-hour totals:', totals);

        return result;
    },
    getSummaryDataLast24Hours: (logs: Log[]) => {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const summaryData = logs.reduce(
            (acc, log) => {
                if (log.createdAt < yesterday) {
                    return acc;
                }

                acc.totalHours += (log.durationMs || 0) / 1000 / 60 / 60;
                acc.keystrokes += log.keysPressedCount || 0;
                acc.leftClickCount += log.leftClickCount || 0;
                acc.rightClickCount += log.rightClickCount || 0;
                acc.middleClickCount += log.middleClickCount || 0;
                acc.mouseMovementInMM += log.mouseMovementInMM || 0;

                return acc;
            },
            {
                totalHours: 0,
                keystrokes: 0,
                leftClickCount: 0,
                rightClickCount: 0,
                middleClickCount: 0,
                mouseMovementInMM: 0,
            }
        );

        // Round totalHours to 2 decimal places
        summaryData.totalHours = Math.round(summaryData.totalHours * 100) / 100;

        return summaryData;
    },
    getSummaryData: (logs: Log[]) => {
        const summaryData = logs.reduce(
            (acc, log) => {
                const date = log.createdAt.toLocaleDateString();
                if (!date) {
                    return acc;
                }

                if (!acc[date]) {
                    acc[date] = {
                        date,
                        totalHours: 0,
                        keystrokes: 0,
                        leftClickCount: 0,
                        rightClickCount: 0,
                        middleClickCount: 0,
                        mouseMovementInMM: 0,
                    };
                }

                acc[date]!.totalHours += (log.durationMs || 0) / 1000 / 60 / 60;
                acc[date]!.keystrokes += log.keysPressedCount || 0;
                acc[date]!.leftClickCount += log.leftClickCount || 0;
                acc[date]!.rightClickCount += log.rightClickCount || 0;
                acc[date]!.middleClickCount += log.middleClickCount || 0;
                acc[date]!.mouseMovementInMM += log.mouseMovementInMM || 0;

                if (log.mouseMovementInMM !== 0) {
                    console.log(log.mouseMovementInMM);
                }


                return acc;
            },
            {} as Record<
                string,
                {
                    date: string;
                    totalHours: number;
                    keystrokes: number;
                    leftClickCount: number;
                    rightClickCount: number;
                    middleClickCount: number;
                    mouseMovementInMM: number;
                }
            >,
        );

        return summaryData;
    },
    getHoursOfActivityToday: (logs: Log[]) => {
        const today = new Date().toDateString();
        const logsToday = logs.filter(
            (log) => new Date(log.createdAt).toDateString() === today,
        );

        return LogHelpers.getHoursOfActivity(logsToday);
    },
    getHoursOfActivity: (logs: Log[]) => {
        const totalMsOfActivity = logs.reduce(
            (acc, log) => acc + (log.durationMs || 0),
            0,
        );
        const totalHoursOfActivity = totalMsOfActivity / 1000 / 60 / 60;

        // round to 2 decimal places
        return Math.round(totalHoursOfActivity * 100) / 100;
    },
    getCountKeyStrokesPerDay: (logs: Log[]) => {
        const keyStrokesPerDay = logs.reduce(
            (acc, log) => {
                if (!log.keysPressedCount) {
                    return acc;
                } else {
                    const date = new Date(log.createdAt).toDateString();
                    acc[date] = acc[date] || 0;
                    acc[date] += log.keysPressedCount;
                    return acc;
                }
            },
            {} as Record<string, number>,
        );

        return keyStrokesPerDay;
    },
    getHoursOfActivityPerDay: (logs: Log[]) => {
        const hoursOfActivityPerDay = logs.reduce(
            (acc, log) => {
                const date = new Date(log.createdAt).toDateString();
                acc[date] = acc[date] || 0;
                acc[date] += (log.durationMs || 0) / 1000 / 60 / 60;
                return acc;
            },
            {} as Record<string, number>,
        );

        return hoursOfActivityPerDay;
    },
    getKeystrokeFrequencyPerHourToday: (logs: Log[]) => {
        const today = new Date().toDateString();
        const logsToday = logs.filter(
            (log) => new Date(log.createdAt).toDateString() === today,
        );

        const keystrokeFrequencyPerHour = logsToday.reduce(
            (acc, log) => {
                const hour = new Date(log.createdAt).getHours();
                const { programProcessName } = log;
                if (!acc[hour]) {
                    acc[hour] = {};
                }
                acc[hour]![programProcessName] =
                    (acc[hour]![programProcessName] || 0) +
                    (log.keysPressedCount || 0);
                return acc;
            },
            {} as Record<number, Record<string, number>>,
        );

        return Object.entries(keystrokeFrequencyPerHour).map(
            ([hour, programData]) => ({
                hour: parseInt(hour),
                ...programData,
            }),
        );
    },
    getAcivityPerProgramToday: (logs: Log[]) => {
        const today = new Date().toDateString();
        const logsToday = logs.filter(
            (log) => new Date(log.createdAt).toDateString() === today,
        );

        const acivityPerProgram = logsToday.reduce(
            (acc, log) => {
                if (!log.programProcessName) {
                    return acc;
                }

                const duration = (log.durationMs || 0) / 1000 / 60 / 60;
                const hours = Math.floor(duration);
                const minutes = Math.round((duration - hours) * 60);
                const formattedDuration = `${hours}.${minutes
                    .toString()
                    .padStart(2, "0")}`;

                if (!acc[log.programProcessName]) {
                    acc[log.programProcessName] = {
                        duration: 0,
                        formattedDuration: "0.00",
                    };
                }

                const programData = acc[log.programProcessName];
                if (programData) {
                    programData.duration += duration;
                    programData.formattedDuration = formattedDuration;
                }

                return acc;
            },
            {} as Record<
                string,
                { duration: number; formattedDuration: string }
            >,
        );

        return acivityPerProgram;
    },
    getAcivityPerProgram: (logs: Log[]) => {
        const acivityPerProgram = logs.reduce(
            (acc, log) => {
                acc[log.programProcessName] = acc[log.programName] || 0;
                acc[log.programProcessName] +=
                    (log.durationMs || 0) / 1000 / 60 / 60;
                return acc;
            },
            {} as Record<string, number>,
        );

        return acivityPerProgram;
    },
    getHoursWorkedPerDay: (logs: Log[]) => {
        const hoursWorkedPerDay = logs.reduce(
            (acc, log) => {
                const date = log.createdAt.toLocaleDateString();
                acc[date] =
                    (acc[date] || 0) + (log.durationMs || 0) / 1000 / 60 / 60;
                return acc;
            },
            {} as Record<string, number>,
        );

        return Object.entries(hoursWorkedPerDay).map(([date, hours]) => ({
            date,
            hours: Math.round(hours * 100) / 100,
        }));
    },
    getCategoryPercentages: (logs: Log[]) => {
        const today = new Date().toDateString();
        const logsToday = logs.filter(
            (log) => new Date(log.createdAt).toDateString() === today,
        );

        const categoryDurations = logsToday.reduce(
            (acc, log) => {
                if (!acc[log.category]) {
                    acc[log.category] = 0;
                }
                acc[log.category] += log.durationMs || 0;
                return acc;
            },
            {} as Record<string, number>,
        );

        const totalDuration = Object.values(categoryDurations).reduce(
            (sum, duration) => sum + duration,
            0,
        );

        const categoryPercentages = Object.entries(categoryDurations).map(
            ([category, duration]) => ({
                category,
                percentage: Math.round((duration / totalDuration) * 100),
            }),
        );

        return categoryPercentages.sort((a, b) => b.percentage - a.percentage);
    },
};
