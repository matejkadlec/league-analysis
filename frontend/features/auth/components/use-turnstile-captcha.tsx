"use client";

import { useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

interface TurnstileCaptchaOptions {
  action: string;
  theme: "light" | "dark";
  appearance: "always" | "interaction-only";
}

/**
 * The captcha plumbing both auth forms need: the widget, the token it hands
 * back, and the reset a rejected submission has to perform (a Turnstile token
 * is single-use). The site key is read per render, not at module scope, so
 * tests can stub the env after importing the form.
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
