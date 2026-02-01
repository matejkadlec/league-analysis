"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useMemo,
} from "react";

interface ApiKeyStatusContextType {
  /** Whether the API key has been detected as invalid/expired */
  isApiKeyInvalid: boolean;
  /** Mark the API key as invalid (called on 401 errors) */
  markApiKeyInvalid: () => void;
  /** Mark the API key as valid (called on successful API calls) */
  markApiKeyValid: () => void;
}

const ApiKeyStatusContext = createContext<ApiKeyStatusContextType | undefined>(
  undefined,
);

// Global reference for the interceptor to access context functions
// This is necessary because Axios interceptors are set up outside React
let globalMarkInvalid: (() => void) | null = null;
let globalMarkValid: (() => void) | null = null;

/**
 * Call this from Axios interceptor when a 401 is detected
 */
export function notifyApiKeyInvalid() {
  globalMarkInvalid?.();
}

/**
 * Call this from Axios interceptor when a successful Riot API call is made
 */
export function notifyApiKeyValid() {
  globalMarkValid?.();
}

export function ApiKeyStatusProvider({ children }: { children: ReactNode }) {
  const [isApiKeyInvalid, setIsApiKeyInvalid] = useState(false);

  const markApiKeyInvalid = useCallback(() => {
    setIsApiKeyInvalid(true);
  }, []);

  const markApiKeyValid = useCallback(() => {
    setIsApiKeyInvalid(false);
  }, []);

  // Register global references for interceptor access
  globalMarkInvalid = markApiKeyInvalid;
  globalMarkValid = markApiKeyValid;

  const value = useMemo(
    () => ({
      isApiKeyInvalid,
      markApiKeyInvalid,
      markApiKeyValid,
    }),
    [isApiKeyInvalid, markApiKeyInvalid, markApiKeyValid],
  );

  return (
    <ApiKeyStatusContext.Provider value={value}>
      {children}
    </ApiKeyStatusContext.Provider>
  );
}

export function useApiKeyStatus() {
  const context = useContext(ApiKeyStatusContext);
  if (context === undefined) {
    throw new Error(
      "useApiKeyStatus must be used within an ApiKeyStatusProvider",
    );
  }
  return context;
}
