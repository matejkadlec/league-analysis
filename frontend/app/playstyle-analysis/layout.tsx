import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Playstyle Analysis - League Analysis",
  description:
    "Analyze League of Legends players playstyle patterns, role preferences, and characteristics.",
};

export default function PlaystyleAnalysisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
