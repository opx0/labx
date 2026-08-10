import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.opxz.dev"),
  title: "DataHubX — context-bound authorization",
  description:
    "A governance layer that binds an AI agent's execution authority to the exact action and the context a human actually approved, then revalidates that context before every privileged mutation.",
  openGraph: {
    title: "DataHubX — context-bound authorization for AI agents",
    description:
      "Stale authority dies. An execution gateway that re-reads DataHub before every mutation and refuses when reality changed.",
    url: "https://app.opxz.dev",
    siteName: "DataHubX",
    type: "website",
  },
  twitter: { card: "summary" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
