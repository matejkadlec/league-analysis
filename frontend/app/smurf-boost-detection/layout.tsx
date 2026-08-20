import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Smurf & Boost Detection",
  description:
    "Compare the selected League of Legends player's recent ranked games against their own earlier games.",
};

export { PassthroughLayout as default } from "@/components/passthrough-layout";
