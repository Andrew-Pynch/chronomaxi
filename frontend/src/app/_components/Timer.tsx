"use client";
import React, { useEffect, useState } from "react";
import { CountdownCircleTimer } from "react-countdown-circle-timer";
import { useTimerStore } from "../../store/timerStore";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./shadcn/Tooltip";

const Timer = () => {
    const { isFirstLoad, setIsFirstLoad, setPreviousDuration } =
        useTimerStore();

    const [hours, setHours] = useState<number | undefined>();
    const [seconds, setSeconds] = useState<number | undefined>();
    const [isPlaying, setIsPlaying] = useState(false);
    const [key, setKey] = useState(0);
    const [duration, setDuration] = useState<number | undefined>(
        !!hours && !!seconds ? hours * 3600 + seconds : undefined,
    );
    useEffect(() => {
        setDuration((hours || 0) * 3600 + (seconds || 0));
    }, [hours, seconds]);

    const sendNotification = () => {
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Timer Expired", {
                body: "Your timer has reached 0!",
            });
        } else if (
            "Notification" in window &&
            Notification.permission !== "denied"
        ) {
            Notification.requestPermission().then((permission) => {
                if (permission === "granted") {
                    new Notification("Timer Expired", {
                        body: "Your timer has reached 0!",
                    });
                }
            });
        }
    };

    const formatTime = (time: any) => {
        const hours = Math.floor(time / 3600);
        const minutes = Math.floor((time % 3600) / 60);
        const seconds = time % 60;

        return `${hours.toString().padStart(2, "0")}:${minutes
            .toString()
            .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    };

    const startTimer = () => {
        setIsPlaying(true);
    };

    const stopTimer = () => {
        setIsPlaying(false);
    };

    const resetTimer = () => {
        setHours(0);
        setSeconds(0);
        setIsPlaying(false);
        setKey((prevKey) => prevKey + 1);
    };

    return (
        <div className="flex flex-col items-center justify-center">
            <div className="p-8 rounded-lg shadow-md">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <h1 className="text-3xl font-bold mb-4 cursor-help">
                                Work Chunking Stopwatch
                            </h1>
                        </TooltipTrigger>
                        <TooltipContent className="bg-black">
                            <h5>
                                Use this timer as a countdown for how long you
                                will work on a particular task.
                            </h5>
                            <p>
                                If the timer reaches 0, we recommend that you
                                stop working on this, and move onto the next
                                task / chunk. Then come back later fired up to
                                finish what you started!
                            </p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <div className="mb-4">
                    <input
                        type="number"
                        value={hours}
                        onChange={(e) => setHours(parseInt(e.target.value))}
                        placeholder="Hours"
                        className="border border-gray-300 rounded px-4 py-2 w-full mb-2"
                    />
                    <input
                        type="number"
                        value={seconds}
                        onChange={(e) => setSeconds(parseInt(e.target.value))}
                        placeholder="Seconds"
                        className="border border-gray-300 rounded px-4 py-2 w-full"
                    />
                </div>
                <div className="mb-4">
                    <button
                        onClick={startTimer}
                        disabled={isPlaying}
                        className="bg-blue-500 text-white px-4 py-2 rounded mr-2 disabled:bg-gray-400"
                    >
                        Start Timer
                    </button>
                    <button
                        onClick={stopTimer}
                        disabled={!isPlaying}
                        className="bg-red-500 text-white px-4 py-2 rounded mr-2 disabled:bg-gray-400"
                    >
                        Stop Timer
                    </button>
                    <button
                        onClick={resetTimer}
                        className="bg-gray-500 text-white px-4 py-2 rounded mr-2"
                    >
                        Reset
                    </button>
                    {/*
                          <button
                            onClick={reusePreviousTime}
                            className="bg-green-500 text-white px-4 py-2 rounded"
                          >
                            Reuse Previous Time
                          </button>
                    */}
                </div>
                <div className="flex justify-center">
                    <CountdownCircleTimer
                        key={key}
                        isPlaying={isPlaying}
                        duration={duration ?? 0}
                        colors={["#004777", "#F7B801", "#A30000", "#A30000"]}
                        colorsTime={[7, 5, 2, 0]}
                        onComplete={() => {
                            setIsPlaying(false);
                            if (!isFirstLoad) {
                                sendNotification();
                            }
                            setIsFirstLoad(false);
                        }}
                    >
                        {({ remainingTime }) => (
                            <div className="text-4xl font-bold">
                                {formatTime(remainingTime)}
                            </div>
                        )}
                    </CountdownCircleTimer>
                </div>
            </div>
        </div>
    );
};

export default Timer;
