import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ContextMenuProvider } from "@/components/context-menu";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "3256 Tools",
  description: "Batteries and fab stock for FRC 3256.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "3256 Tools",
  },
  icons: {
    icon: "/icon-192.png?v=wb1",
    apple: "/icon-192.png?v=wb1",
  },
};

export const viewport: Viewport = {
  themeColor: "#201632",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${plexMono.variable} h-full antialiased`}>
      <head>
        {/* Apply the saved appearance before paint, as recommended by the bundled Next.js guide. */}
        <script dangerouslySetInnerHTML={{ __html: `(()=>{let t;try{t=localStorage.getItem("3256-tools-theme")}catch{}t=t==="light"||t==="dark"?t:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t;document.querySelector('meta[name="theme-color"]')?.setAttribute("content",t==="dark"?"#0f1115":"#f5f6f8")})()` }} />
      </head>
      <body className="min-h-full flex flex-col"><ContextMenuProvider>{children}</ContextMenuProvider></body>
    </html>
  );
}
