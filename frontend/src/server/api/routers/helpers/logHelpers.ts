import { Log } from "@prisma/client";

const convertMMToInches = (value?: number | null): number => {
    if (!value) return 0;
    return Number((value / 25.4).toFixed(2));
};

const minutesToDate = (minutes: number | bigint): Date => {
    return new Date(Number(minutes) * 60 * 1000);
};

const getMinutesSinceEpoch = (date: Date): number => {
    return Math.floor(date.getTime() / (60 * 1000));
};

export const LogHelpers = {
    getInteractionDataLast24Hours: (logs: Log[]) => {
        const now = new Date();
        const yesterdayMinutes = getMinutesSinceEpoch(now) - 24 * 60;
        const hourlyData: Record<string, {
            keyPresses: number,
            mouseMovement: number,
            leftClicks: number,
            rightClicks: number,
            middleClicks: number
        }> = {};

        logs.filter(log => (log.createdAtMinutes || 0) >= yesterdayMinutes).forEach(log => {
            const date = minutesToDate(log.createdAtMinutes || 0);
            const hourKey = date.toISOString().slice(0, 13);
            if (!hourlyData[hourKey]) {
                hourlyData[hourKey] = {
                    keyPresses: 0,
                    mouseMovement: 0,
                    leftClicks: 0,
                    rightClicks: 0,
                    middleClicks: 0
                };
            }
            hourlyData[hourKey]!.keyPresses += log.keysPressedCount || 0;
            hourlyData[hourKey]!.mouseMovement += log.mouseMovementInMM || 0;
            hourlyData[hourKey]!.leftClicks += log.leftClickCount || 0;
            hourlyData[hourKey]!.rightClicks += log.rightClickCount || 0;
            hourlyData[hourKey]!.middleClicks += log.middleClickCount || 0;
        });

        // Fill in missing hours
        for (let i = 0; i < 24; i++) {
            const hourDate = new Date(now.getTime() - i * 60 * 60 * 1000);
            const hourKey = hourDate.toISOString().slice(0, 13);
            if (!hourlyData[hourKey]) {
                hourlyData[hourKey] = {
                    keyPresses: 0,
                    mouseMovement: 0,
                    leftClicks: 0,
                    rightClicks: 0,
                    middleClicks: 0
                };
            }
        }

        return Object.entries(hourlyData)
            .map(([time, data]) => ({
                time: time + ':00:00.000Z',
                mouseMovementInInches: convertMMToInches(data.mouseMovement),
                leftClickCount: data.leftClicks,
                rightClickCount: data.rightClicks,
                middleClickCount: data.middleClicks,
                keystrokes: data.keyPresses
            }))
            .sort((a, b) => a.time.localeCompare(b.time));
    },

    getSummaryDataLast24Hours: (logs: Log[]) => {
        const now = getMinutesSinceEpoch(new Date());
        const yesterdayMinutes = now - 24 * 60;

        let summaryData = logs.reduce(
            (acc, log) => {
                if ((log.createdAtMinutes || 0) < yesterdayMinutes) {
                    return acc;
                }

                acc.totalHours += (log.durationMinutes || 0) / 60;
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
                mouseMovementInInches: 0
            }
        );

        summaryData.totalHours = Math.round(summaryData.totalHours * 100) / 100;
        summaryData.mouseMovementInInches = convertMMToInches(summaryData.mouseMovementInMM);

        return {
            totalHours: summaryData.totalHours,
            keystrokes: summaryData.keystrokes,
            leftClickCount: summaryData.leftClickCount,
            rightClickCount: summaryData.rightClickCount,
            middleClickCount: summaryData.middleClickCount,
            mouseMovementInInches: summaryData.mouseMovementInInches
        };
    },

    getHoursOfActivityToday: (logs: Log[]) => {
        const todayStart = getMinutesSinceEpoch(new Date(new Date().setHours(0, 0, 0, 0)));
        const logsToday = logs.filter(log => (log.createdAtMinutes || 0) >= todayStart);
        return LogHelpers.getHoursOfActivity(logsToday);
    },

    getHoursOfActivity: (logs: Log[]) => {
        const totalMinutesOfActivity = logs.reduce(
            (acc, log) => acc + (log.durationMinutes || 0),
            0
        );
        const totalHoursOfActivity = totalMinutesOfActivity / 60;
        return Math.round(totalHoursOfActivity * 100) / 100;
    },

    getCountKeyStrokesPerDay: (logs: Log[]) => {
        const keyStrokesPerDay = logs.reduce((acc, log) => {
            if (!log.keysPressedCount) return acc;
            const date = minutesToDate(log.createdAtMinutes || 0).toDateString();
            acc[date] = (acc[date] || 0) + log.keysPressedCount;
            return acc;
        }, {} as Record<string, number>);

        return keyStrokesPerDay;
    },

    getHoursOfActivityPerDay: (logs: Log[]) => {
        const hoursOfActivityPerDay = logs.reduce((acc, log) => {
            const date = minutesToDate(log.createdAtMinutes || 0).toDateString();
            acc[date] = (acc[date] || 0) + ((log.durationMinutes || 0) / 60);
            return acc;
        }, {} as Record<string, number>);

        return hoursOfActivityPerDay;
    },

    getKeystrokeFrequencyPerHourToday: (logs: Log[]) => {
        const todayStart = getMinutesSinceEpoch(new Date(new Date().setHours(0, 0, 0, 0)));
        const logsToday = logs.filter(log => (log.createdAtMinutes || 0) >= todayStart);

        const keystrokeFrequencyPerHour = logsToday.reduce((acc, log) => {
            const hour = minutesToDate(log.createdAtMinutes || 0).getHours();
            const { programProcessName } = log;
            if (!acc[hour]) {
                acc[hour] = {};
            }
            if (programProcessName) {
                acc[hour]![programProcessName] = (acc[hour]![programProcessName] || 0) +
                    (log.keysPressedCount || 0);
            }
            return acc;
        }, {} as Record<number, Record<string, number>>);

        return Object.entries(keystrokeFrequencyPerHour).map(([hour, programData]) => ({
            hour: parseInt(hour),
            ...programData,
        }));
    },

    getAcivityPerProgramToday: (logs: Log[]) => {
        const todayStart = getMinutesSinceEpoch(new Date(new Date().setHours(0, 0, 0, 0)));
        const logsToday = logs.filter(log => (log.createdAtMinutes || 0) >= todayStart);

        return logsToday.reduce((acc, log) => {
            if (!log.programProcessName) return acc;

            const duration = (log.durationMinutes || 0) / 60;
            const hours = Math.floor(duration);
            const minutes = Math.round((duration - hours) * 60);
            const formattedDuration = `${hours}.${minutes.toString().padStart(2, "0")}`;

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
        }, {} as Record<string, { duration: number; formattedDuration: string }>);
    },

    getHoursWorkedPerDay: (logs: Log[]) => {
        const hoursWorkedPerDay = logs.reduce((acc, log) => {
            const date = minutesToDate(log.createdAtMinutes || 0).toLocaleDateString();
            acc[date] = (acc[date] || 0) + ((log.durationMinutes || 0) / 60);
            return acc;
        }, {} as Record<string, number>);

        return Object.entries(hoursWorkedPerDay).map(([date, hours]) => ({
            date,
            hours: Math.round(hours * 100) / 100,
        }));
    },

    getCategoryPercentages: (logs: Log[]) => {
        const todayStart = getMinutesSinceEpoch(new Date(new Date().setHours(0, 0, 0, 0)));
        const logsToday = logs.filter(log => (log.createdAtMinutes || 0) >= todayStart);

        const categoryDurations = logsToday.reduce((acc, log) => {
            if (!log.category) return acc;
            acc[log.category] = (acc[log.category] || 0) + (log.durationMinutes || 0);
            return acc;
        }, {} as Record<string, number>);

        const totalDuration = Object.values(categoryDurations).reduce(
            (sum, duration) => sum + duration,
            0
        );

        const categoryPercentages = Object.entries(categoryDurations).map(
            ([category, duration]) => ({
                category,
                percentage: Math.round((duration / totalDuration) * 100),
            })
        );

        return categoryPercentages.sort((a, b) => b.percentage - a.percentage);
    },

    getStatsForLogs: (logs: Log[]) => {
        // per day stats
        const hoursOfActivityPerDay = LogHelpers.getHoursOfActivityPerDay(logs);
        const countKeyStrokesPerDay = LogHelpers.getCountKeyStrokesPerDay(logs);
        const activityPerProgramPerDay = LogHelpers.getAcivityPerProgramToday(logs);
        const hoursWorkedPerDay = LogHelpers.getHoursWorkedPerDay(logs);

        // today stats
        const hoursOfActivityToday = LogHelpers.getHoursOfActivityToday(logs);
        const keystrokeFrequencyPerHourToday = LogHelpers.getKeystrokeFrequencyPerHourToday(logs);
        const interactionDataLast24Hours = LogHelpers.getInteractionDataLast24Hours(logs);
        const activityPerProgramToday = LogHelpers.getAcivityPerProgramToday(logs);
        const categoryPercentages = LogHelpers.getCategoryPercentages(logs);
        const summaryDataLast24Hours = LogHelpers.getSummaryDataLast24Hours(logs);

        return {
            hoursOfActivityPerDay,
            countKeyStrokesPerDay,
            activityPerProgramPerDay,
            hoursOfActivityToday,
            interactionDataLast24Hours,
            keystrokeFrequencyPerHourToday,
            activityPerProgramToday,
            summaryDataLast24Hours,
            hoursWorkedPerDay,
            categoryPercentages,
        };
    },
};
