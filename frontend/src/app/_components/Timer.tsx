"use client";

import { useEffect, useState } from "react";
import { CountdownCircleTimer } from "react-countdown-circle-timer";
import { useTimerStore } from "../../store/timerStore";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./shadcn/Tooltip";

const clampTimerValue = (value: string) => {
    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return 0;
    }

    return parsedValue;
};

const formatTime = (time: number) => {
    const safeTime = Number.isFinite(time) ? Math.max(Math.floor(time), 0) : 0;
    const hours = Math.floor(safeTime / 3600);
    const minutes = Math.floor((safeTime % 3600) / 60);
    const seconds = safeTime % 60;

    return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

const Timer = () => {
    const {
        isFirstLoad,
        setDuration,
        setIsFirstLoad,
        setIsRunning,
        setPreviousDuration,
        setTimeRemaining,
    } = useTimerStore();

    const [hours, setHours] = useState(0);
    const [seconds, setSeconds] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [key, setKey] = useState(0);

    const duration = Math.max(hours * 3600 + seconds, 0);
    const canStart = duration > 0 && !isPlaying;

    useEffect(() => {
        setDuration(duration);
        setTimeRemaining(duration);
    }, [duration, setDuration, setTimeRemaining]);

    useEffect(() => {
        setIsRunning(isPlaying);
    }, [isPlaying, setIsRunning]);

    const sendNotification = () => {
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Timer expired", {
                body: "Your focus block has reached zero.",
            });
        } else if (
            "Notification" in window &&
            Notification.permission !== "denied"
        ) {
            Notification.requestPermission().then((permission) => {
                if (permission === "granted") {
                    new Notification("Timer expired", {
                        body: "Your focus block has reached zero.",
                    });
                }
            });
        }
    };

    const startTimer = () => {
        if (!canStart) {
            return;
        }

        setPreviousDuration(duration);
        setIsPlaying(true);
    };

    const stopTimer = () => {
        setIsPlaying(false);
    };

    const resetTimer = () => {
        setHours(0);
        setSeconds(0);
        setIsPlaying(false);
        setTimeRemaining(0);
        setKey((prevKey) => prevKey + 1);
    };

    return (
        <aside className="self-start rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-xl shadow-black/20 backdrop-blur xl:row-span-2">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            className="text-left text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-zinc-500 outline-none transition hover:text-zinc-300 focus-visible:text-zinc-200"
                        >
                            Focus timer
                        </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs border border-zinc-800 bg-zinc-950 text-zinc-300 shadow-2xl shadow-black/40">
                        <p className="text-sm leading-5">
                            Set a focused work block. When it reaches zero,
                            move to the next task or take a break.
                        </p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <div className="mt-5 flex justify-center">
                <CountdownCircleTimer
                    key={key}
                    isPlaying={isPlaying}
                    duration={duration}
                    colors="#818cf8"
                    trailColor="#27272a"
                    size={172}
                    strokeWidth={10}
                    trailStrokeWidth={10}
                    onUpdate={setTimeRemaining}
                    onComplete={() => {
                        setIsPlaying(false);
                        setTimeRemaining(0);
                        if (!isFirstLoad) {
                            sendNotification();
                        }
                        setIsFirstLoad(false);
                    }}
                >
                    {({ remainingTime }) => (
                        <div className="text-center">
                            <div className="text-2xl font-semibold tabular-nums tracking-[-0.03em] text-white">
                                {formatTime(remainingTime)}
                            </div>
                            <div className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">
                                remaining
                            </div>
                        </div>
                    )}
                </CountdownCircleTimer>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
                <label className="space-y-2 text-xs font-medium text-zinc-500">
                    Hours
                    <input
                        type="number"
                        min={0}
                        value={hours}
                        onChange={(event) =>
                            setHours(clampTimerValue(event.target.value))
                        }
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-sm tabular-nums text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/20"
                    />
                </label>
                <label className="space-y-2 text-xs font-medium text-zinc-500">
                    Seconds
                    <input
                        type="number"
                        min={0}
                        value={seconds}
                        onChange={(event) =>
                            setSeconds(clampTimerValue(event.target.value))
                        }
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-sm tabular-nums text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/20"
                    />
                </label>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                    type="button"
                    onClick={startTimer}
                    disabled={!canStart}
                    className="rounded-xl bg-indigo-500 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
                >
                    Start
                </button>
                <button
                    type="button"
                    onClick={stopTimer}
                    disabled={!isPlaying}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:text-zinc-600"
                >
                    Pause
                </button>
                <button
                    type="button"
                    onClick={resetTimer}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white"
                >
                    Reset
                </button>
            </div>
        </aside>
    );
};

export default Timer;
