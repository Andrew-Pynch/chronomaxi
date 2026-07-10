import "~/styles/globals.css";
import "react-toastify/dist/ReactToastify.css";

import { type Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "~/app/_components/Providers";

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-sans",
});

export const metadata: Metadata = {
    title: "chronomaxi",
    description: "Personal time tracking analytics for local activity logs.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body
                className={`${inter.variable} min-h-screen bg-zinc-950 font-sans text-zinc-100 antialiased`}
            >
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
