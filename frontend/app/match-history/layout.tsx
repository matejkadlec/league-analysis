import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Match History",
  description:
    "View detailed League of Legends match history for the selected player.",
};

export default function MatchHistoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
