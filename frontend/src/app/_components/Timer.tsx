"use client";

import { useRef, useState } from "react";
import { CountdownCircleTimer } from "react-countdown-circle-timer";
import { Panel } from "~/components/nerv";
import { cn } from "~/lib/utils";

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

const inputClass =
    "w-full border border-grid-strong bg-void px-3 py-2 font-data text-sm tabular-nums text-fg-1 outline-none transition-colors duration-150 ease-nerv placeholder:text-fg-muted focus:border-primary";

const Timer = () => {
    const [hours, setHours] = useState(0);
    const [seconds, setSeconds] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [key, setKey] = useState(0);
    const isFirstLoad = useRef(true);

    const duration = Math.max(hours * 3600 + seconds, 0);
    const canStart = duration > 0 && !isPlaying;

    const sendNotification = () => {
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Timer expired", {
                body: "Your focus block has reached zero.",
            });
        } else if (
            "Notification" in window &&
            Notification.permission !== "denied"
        ) {
            void Notification.requestPermission().then((permission) => {
                if (permission === "granted") {
                    new Notification("Timer expired", {
                        body: "Your focus block has reached zero.",
                    });
                }
            });
        }
    };

    const startTimer = () => {
        if (canStart) {
            setIsPlaying(true);
        }
    };

    const stopTimer = () => {
        setIsPlaying(false);
    };

    const resetTimer = () => {
        setHours(0);
        setSeconds(0);
        setIsPlaying(false);
        setKey((previousKey) => previousKey + 1);
    };

    return (
        <Panel
            title="Focus Timer"
            titleJp="集中タイマー"
            id="PANEL-201"
            className="self-start xl:row-span-2"
        >
            <svg width="0" height="0" aria-hidden className="absolute">
                <defs>
                    <linearGradient id="timerRingStroke" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" style={{ stopColor: "var(--primary)" }} />
                        <stop offset="100%" style={{ stopColor: "var(--secondary)" }} />
                    </linearGradient>
                </defs>
            </svg>

            <div className="flex justify-center">
                <CountdownCircleTimer
                    key={key}
                    isPlaying={isPlaying}
                    duration={duration}
                    colors="url(#timerRingStroke)"
                    trailColor="rgba(255, 255, 255, 0.08)"
                    size={172}
                    strokeWidth={3}
                    trailStrokeWidth={3}
                    onComplete={() => {
                        setIsPlaying(false);
                        if (!isFirstLoad.current) {
                            sendNotification();
                        }
                        isFirstLoad.current = false;
                    }}
                >
                    {({ remainingTime }) => (
                        <div className="text-center">
                            <div className="font-data text-lg tabular-nums text-fg-1">
                                {formatTime(remainingTime)}
                            </div>
                            <div className="mt-1 font-body text-2xs uppercase tracking-nerv text-fg-muted">
                                remaining
                            </div>
                        </div>
                    )}
                </CountdownCircleTimer>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
                <label className="space-y-2 font-body text-2xs uppercase tracking-nerv text-fg-2">
                    Hours
                    <input
                        type="number"
                        min={0}
                        value={hours}
                        onChange={(event) =>
                            setHours(clampTimerValue(event.target.value))
                        }
                        className={inputClass}
                    />
                </label>
                <label className="space-y-2 font-body text-2xs uppercase tracking-nerv text-fg-2">
                    Seconds
                    <input
                        type="number"
                        min={0}
                        value={seconds}
                        onChange={(event) =>
                            setSeconds(clampTimerValue(event.target.value))
                        }
                        className={inputClass}
                    />
                </label>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                    type="button"
                    onClick={startTimer}
                    disabled={!canStart}
                    className={cn(
                        "border border-primary bg-primary px-3 py-2 font-body text-2xs uppercase tracking-nerv text-fg-inverse transition-opacity duration-150 ease-nerv",
                        "disabled:cursor-not-allowed disabled:border-grid-strong disabled:bg-transparent disabled:text-fg-muted",
                    )}
                >
                    Start
                </button>
                <button
                    type="button"
                    onClick={stopTimer}
                    disabled={!isPlaying}
                    className={cn(
                        "border border-grid-strong px-3 py-2 font-body text-2xs uppercase tracking-nerv text-fg-2 transition-colors duration-150 ease-nerv hover:border-primary hover:text-primary",
                        "disabled:cursor-not-allowed disabled:text-fg-muted disabled:hover:border-grid-strong disabled:hover:text-fg-muted",
                    )}
                >
                    Pause
                </button>
                <button
                    type="button"
                    onClick={resetTimer}
                    className="border border-grid-strong px-3 py-2 font-body text-2xs uppercase tracking-nerv text-fg-2 transition-colors duration-150 ease-nerv hover:border-primary hover:text-primary"
                >
                    Reset
                </button>
            </div>
        </Panel>
    );
};

export default Timer;
