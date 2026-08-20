import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Player Overview",
  description:
    "View the selected League of Legends player's profile and aggregate statistics.",
};

export { PassthroughLayout as default } from "@/components/passthrough-layout";
