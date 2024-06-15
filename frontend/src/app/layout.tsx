"use client";
import "~/styles/globals.css";
import { Inter } from "next/font/google";
import { TRPCReactProvider } from "~/trpc/react";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useEffect } from "react"; // Import the useEffect hook
import { useTimerStore } from "~/store/timerStore"; // Import the useTimerStore hook
import { ThemeProvider } from "next-themes";
import { usePathname } from "next/navigation";

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-sans",
});

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();

    const timeRemaining = useTimerStore((state) => state.timeRemaining); // Access the timeRemaining value from the store

    useEffect(() => {
        const updateTabName = () => {
            const formattedTime = formatTime(timeRemaining);
            if (formattedTime === "00:00") {
                document.title = "chronomaxi"; // Reset the tab name to the default when the timer reaches 0
                return;
            } else {
                document.title = `${formattedTime} - chronomaxi`; // Update the tab name with the formatted time
            }
        };

        updateTabName(); // Update the tab name initially

        const interval = setInterval(updateTabName, 1000); // Update the tab name every second

        return () => {
            clearInterval(interval); // Clear the interval when the component unmounts
        };
    }, [timeRemaining]); // Re-run the effect whenever timeRemaining changes

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = time % 60;
        return `${minutes.toString().padStart(2, "0")}:${seconds
            .toString()
            .padStart(2, "0")}`;
    };

    return (
        <html lang="en">
            <body className={`font-sans ${inter.variable}`}>
                <ThemeProvider>
                    <ToastContainer />
                    <TRPCReactProvider>
                        <div className="z-0">{children}</div>
                    </TRPCReactProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
