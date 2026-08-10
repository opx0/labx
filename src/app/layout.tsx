import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DataHubX — context-bound authorization",
  description:
    "A governance layer that binds an AI agent's execution authority to the exact action and the context a human actually approved, then revalidates that context before every privileged mutation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
