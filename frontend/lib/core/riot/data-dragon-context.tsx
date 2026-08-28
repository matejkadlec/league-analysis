"use client";

import { createContext, useContext } from "react";
import { DDRAGON_FALLBACK_VERSION } from "./data-dragon";

const DDragonVersionContext = createContext(DDRAGON_FALLBACK_VERSION);

export function DDragonVersionProvider({
  children,
  version,
}: {
  children: React.ReactNode;
  version: string;
}) {
  return (
    <DDragonVersionContext.Provider value={version}>
      {children}
    </DDragonVersionContext.Provider>
  );
}

export function useDDragonVersion(): string {
  return useContext(DDragonVersionContext);
}
