"use client";

import { useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

interface TurnstileCaptchaOptions {
  action: string;
  theme: "light" | "dark";
  appearance: "always" | "interaction-only";
}

/**
 * A Turnstile token is single-use, so a rejected submission must reset. The
 * site key is read per render so tests can stub the env.
 */
export function useTurnstileCaptcha({
  action,
  theme,
  appearance,
}: TurnstileCaptchaOptions) {
  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileInstance | undefined>(undefined);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";

  return {
    token,
    isConfigured: siteKey.length > 0,
    reset: () => {
      setToken(null);
      widgetRef.current?.reset();
    },
    widget: (
      <Turnstile
        ref={widgetRef}
        siteKey={siteKey}
        onSuccess={(nextToken) => {
          setToken(nextToken);
        }}
        onExpire={() => {
          setToken(null);
        }}
        onError={() => {
          setToken(null);
        }}
        options={{
          action,
          theme,
          size: "flexible",
          appearance,
          refreshExpired: "auto",
        }}
      />
    ),
  };
}
