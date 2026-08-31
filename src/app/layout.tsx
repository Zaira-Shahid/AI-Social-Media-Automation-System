import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "AI Social Media Command Center",
  description: "Internal AI social media automation system",
};

/**
 * Root layout — chrome only.
 *
 * The application shell moved into the `(app)` route group, which is behind
 * `requireUser()`. Rendering it here would put navigation around the login
 * page and around the unauthorized page.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
