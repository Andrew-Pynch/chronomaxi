import { Log } from "@prisma/client";

export const LogHelpers = {
    getStatsForLogs: (logs: Log[]) => {
        // per day stats
        const hoursOfActivityPerDay = LogHelpers.getHoursOfActivityPerDay(logs);
        const countKeyStrokesPerDay = LogHelpers.getCountKeyStrokesPerDay(logs);
        const activityPerProgramPerDay =
            LogHelpers.getAcivityPerProgramToday(logs);
        const summaryData = LogHelpers.getSummaryData(logs);
        const hoursWorkedPerDay = LogHelpers.getHoursWorkedPerDay(logs);

        // today stats
        const hoursOfAcitivityToday = LogHelpers.getHoursOfActivityToday(logs);
        const keystrokeFrequencyPerHourToday =
            LogHelpers.getKeystrokeFrequencyPerHourToday(logs);
        const acivityPerProgramToday =
            LogHelpers.getAcivityPerProgramToday(logs);

        return {
            hoursOfActivityPerDay,
            countKeyStrokesPerDay,
            activityPerProgramPerDay,
            hoursOfAcitivityToday,
            keystrokeFrequencyPerHourToday,
            acivityPerProgramToday,
            summaryData,
            hoursWorkedPerDay,
        };
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
                    };
                }

                acc[date]!.totalHours += (log.durationMs || 0) / 1000 / 60 / 60;
                acc[date]!.keystrokes += log.keysPressedCount || 0;

                return acc;
            },
            {} as Record<
                string,
                { date: string; totalHours: number; keystrokes: number }
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
};
