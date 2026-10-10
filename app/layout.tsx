import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FastEvent — Event studies",
  description: "Private event-aligned market research workspace",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
