"use client";

import { ThemeProvider } from "next-themes";
import { ToastContainer } from "react-toastify";
import { TRPCReactProvider } from "~/trpc/react";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
            <ToastContainer theme="dark" />
            <TRPCReactProvider>{children}</TRPCReactProvider>
        </ThemeProvider>
    );
}
