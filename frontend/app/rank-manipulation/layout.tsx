import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rank Manipulation",
  description:
    "Compare a League of Legends player's recent ranked games against their own earlier games.",
};

export { PassthroughLayout as default } from "@/components/passthrough-layout";
