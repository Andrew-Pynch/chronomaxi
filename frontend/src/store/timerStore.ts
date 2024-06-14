import create from "zustand";
interface TimerState {
    isFirstLoad: boolean;
    duration: number;
    isRunning: boolean;
    timeRemaining: number;
    previousDuration: number;
    setIsFirstLoad: (value: boolean) => void;
    setDuration: (value: number) => void;
    setIsRunning: (value: boolean) => void;
    setTimeRemaining: (value: number) => void;
    setPreviousDuration: (value: number) => void;
}
export const useTimerStore = create<TimerState>((set) => ({
    isFirstLoad: true,
    duration: 0,
    isRunning: false,
    timeRemaining: 0,
    previousDuration: 0,
    setIsFirstLoad: (value: boolean) => set({ isFirstLoad: value }),
    setDuration: (value: number) => set({ duration: value }),
    setIsRunning: (value: boolean) => set({ isRunning: value }),
    setTimeRemaining: (value: number) => set({ timeRemaining: value }),
    setPreviousDuration: (value: number) => set({ previousDuration: value }),
}));
