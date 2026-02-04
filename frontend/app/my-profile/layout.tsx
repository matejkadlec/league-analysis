import { ReactNode } from "react";

export const metadata = {
  title: "My Profile",
  description:
    "View your League of Legends profile, match history, and personal statistics.",
};

export default function MyProfileLayout({ children }: { children: ReactNode }) {
  return children;
}
