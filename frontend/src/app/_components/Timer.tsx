"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CountdownCircleTimer } from "react-countdown-circle-timer";
import { Panel } from "~/components/nerv";
import { api } from "~/lib/convexApi";
import { cn } from "~/lib/utils";

const MS_PER_SECOND = 1_000;
const TICK_MS = 1_000;

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

// Focus timer widget: Convex's `timerState` singleton is the ONLY source of
// truth (durationMs, runningSince, pausedRemainingMs, updatedAt) -- every
// open dashboard tab subscribes to the same row, so start/pause/reset from
// any viewer converges every other viewer's countdown. Between server
// pushes (which only happen on a mutation, not on a schedule), remaining
// time is derived locally from `runningSince` on a 1s tick, per viewer.
const Timer = () => {
    const timerView = useQuery(api.timer.get);
    const start = useMutation(api.timer.start);
    const pause = useMutation(api.timer.pause);
    const reset = useMutation(api.timer.reset);

    const [hoursInput, setHoursInput] = useState(0);
    const [secondsInput, setSecondsInput] = useState(0);
    const [nowMs, setNowMs] = useState(() => Date.now());

    const inputsSeededRef = useRef(false);
    const previousRemainingMsRef = useRef<number | null>(null);
    const notifiedForRunRef = useRef<number | null>(null);

    useEffect(() => {
        if (inputsSeededRef.current || !timerView) return;
        inputsSeededRef.current = true;
        const totalSeconds = Math.round(timerView.durationMs / MS_PER_SECOND);
        setHoursInput(Math.floor(totalSeconds / 3600));
        setSecondsInput(totalSeconds % 3600);
    }, [timerView]);

    useEffect(() => {
        if (!timerView?.running) return;
        const interval = setInterval(() => setNowMs(Date.now()), TICK_MS);
        return () => clearInterval(interval);
    }, [timerView?.running]);

    const remainingMs = useMemo(() => {
        if (!timerView) return 0;
        if (!timerView.running || timerView.runningSince === null) {
            return timerView.remainingMs;
        }
        return Math.max(0, timerView.durationMs - (nowMs - timerView.runningSince));
    }, [timerView, nowMs]);

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

    // Fires once per server-visible "run" (keyed on updatedAt) the FIRST
    // time this client observes a live >0 -> <=0 crossing while running --
    // never on initial load of an already-expired timer (previous === null
    // guards that), matching the original component's isFirstLoad guard.
    useEffect(() => {
        if (!timerView) return;
        const previousRemainingMs = previousRemainingMsRef.current;
        previousRemainingMsRef.current = remainingMs;

        if (
            timerView.running &&
            remainingMs <= 0 &&
            previousRemainingMs !== null &&
            previousRemainingMs > 0 &&
            notifiedForRunRef.current !== timerView.updatedAt
        ) {
            notifiedForRunRef.current = timerView.updatedAt;
            sendNotification();
        }
    }, [timerView, remainingMs]);

    if (!timerView) {
        return (
            <Panel title="Focus Timer" titleJp="集中タイマー" id="PANEL-201">
                <p className="font-body text-sm text-fg-2">Awaiting timer state...</p>
            </Panel>
        );
    }

    const remainingSeconds = Math.ceil(remainingMs / MS_PER_SECOND);
    const durationSeconds = Math.max(1, Math.round(timerView.durationMs / MS_PER_SECOND));
    const canStart = !timerView.running;

    const handleStart = () => {
        const requestedSeconds = Math.max(hoursInput * 3600 + secondsInput, 0);
        void start({
            durationMs: requestedSeconds > 0 ? requestedSeconds * MS_PER_SECOND : undefined,
        });
    };

    return (
        <Panel title="Focus Timer" titleJp="集中タイマー" id="PANEL-201">
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
                    key={timerView.updatedAt}
                    isPlaying={timerView.running}
                    duration={durationSeconds}
                    initialRemainingTime={remainingSeconds}
                    colors="url(#timerRingStroke)"
                    trailColor="rgba(255, 255, 255, 0.08)"
                    size={172}
                    strokeWidth={3}
                    trailStrokeWidth={3}
                >
                    {() => (
                        <div className="text-center">
                            <div className="font-data text-lg tabular-nums text-fg-1">
                                {formatTime(remainingSeconds)}
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
                        value={hoursInput}
                        onChange={(event) =>
                            setHoursInput(clampTimerValue(event.target.value))
                        }
                        className={inputClass}
                    />
                </label>
                <label className="space-y-2 font-body text-2xs uppercase tracking-nerv text-fg-2">
                    Seconds
                    <input
                        type="number"
                        min={0}
                        value={secondsInput}
                        onChange={(event) =>
                            setSecondsInput(clampTimerValue(event.target.value))
                        }
                        className={inputClass}
                    />
                </label>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                    type="button"
                    onClick={handleStart}
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
                    onClick={() => void pause({})}
                    disabled={!timerView.running}
                    className={cn(
                        "border border-grid-strong px-3 py-2 font-body text-2xs uppercase tracking-nerv text-fg-2 transition-colors duration-150 ease-nerv hover:border-primary hover:text-primary",
                        "disabled:cursor-not-allowed disabled:text-fg-muted disabled:hover:border-grid-strong disabled:hover:text-fg-muted",
                    )}
                >
                    Pause
                </button>
                <button
                    type="button"
                    onClick={() => void reset({})}
                    className="border border-grid-strong px-3 py-2 font-body text-2xs uppercase tracking-nerv text-fg-2 transition-colors duration-150 ease-nerv hover:border-primary hover:text-primary"
                >
                    Reset
                </button>
            </div>
        </Panel>
    );
};

export default Timer;
