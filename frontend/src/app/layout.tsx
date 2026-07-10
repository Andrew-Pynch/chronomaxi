import "~/styles/globals.css";

import {
    Archivo_Black,
    Noto_Sans_JP,
    Orbitron,
    Share_Tech_Mono,
    Space_Mono,
} from "next/font/google";
import { type Metadata, type Viewport } from "next";
import { ConvexClientProvider } from "~/components/ConvexClientProvider";
import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES } from "~/lib/theme";

const archivoBlack = Archivo_Black({
    subsets: ["latin"],
    weight: "400",
    variable: "--font-archivo-black",
});

const spaceMono = Space_Mono({
    subsets: ["latin"],
    weight: ["400", "700"],
    variable: "--font-space-mono",
});

const shareTechMono = Share_Tech_Mono({
    subsets: ["latin"],
    weight: "400",
    variable: "--font-share-tech-mono",
});

const orbitron = Orbitron({
    subsets: ["latin"],
    weight: ["700", "900"],
    variable: "--font-orbitron",
});

const notoSansJp = Noto_Sans_JP({
    subsets: ["latin"],
    weight: ["400", "700"],
    variable: "--font-noto-sans-jp",
});

export const metadata: Metadata = {
    title: "chronomaxi",
    description: "Local and remote activity observation terminal.",
    icons: {
        icon: [
            { url: "/icon.svg", type: "image/svg+xml" },
            { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
            { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
        apple: [{ url: "/apple-icon.png" }],
        shortcut: ["/favicon.ico"],
    },
};

export const viewport: Viewport = {
    themeColor: "#0a0a0f",
};

// Sets data-theme on <html> before hydration so the persisted theme preset
// paints on first frame instead of flashing the "nerv" default.
const THEME_INIT_SCRIPT = `(function(){try{var stored=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
)});var valid=${JSON.stringify(THEMES)};document.documentElement.setAttribute("data-theme", valid.indexOf(stored)!==-1?stored:${JSON.stringify(
    DEFAULT_THEME,
)});}catch(e){document.documentElement.setAttribute("data-theme", ${JSON.stringify(
    DEFAULT_THEME,
)});}})();`;

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
            <head>
                <script
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
                />
            </head>
            <body
                className={`${archivoBlack.variable} ${spaceMono.variable} ${shareTechMono.variable} ${orbitron.variable} ${notoSansJp.variable} min-h-screen bg-canvas font-body text-fg-1 antialiased`}
            >
                <ConvexClientProvider>{children}</ConvexClientProvider>
            </body>
        </html>
    );
}
