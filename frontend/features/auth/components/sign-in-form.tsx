"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import Image from "next/image";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useAuth } from "../context/auth-context";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PublicPageFooter } from "@/components/public-page-footer";
import type { AuthLoginError, LoginCredentials } from "../types";

export function SignInForm() {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance | undefined>(undefined);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const isTurnstileConfigured = turnstileSiteKey.length > 0;

  const form = useForm<LoginCredentials>({
    defaultValues: {
      email: "",
      password: "",
    },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });

  // Watch form values to enable/disable submit button
  // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() is intentionally not memoizable
  const email = form.watch("email");
  const password = form.watch("password");
  const isFormValid = email.trim().length > 0 && password.trim().length > 0;
  const isCaptchaSatisfied =
    !captchaRequired || (isTurnstileConfigured && captchaToken !== null);

  const onSubmit = async (data: LoginCredentials) => {
    setError(null);
    setIsSubmitting(true);

    try {
      await login({
        ...data,
        captchaToken,
      });
    } catch (err) {
      const authError = err as AuthLoginError;
      const authMessage =
        authError instanceof Error ? authError.message : "Login failed";

      if (
        authError.code === "CAPTCHA_REQUIRED" ||
        authError.code === "CAPTCHA_INVALID"
      ) {
        setCaptchaRequired(true);
        setCaptchaToken(null);
        turnstileRef.current?.reset();
      }

      if (authError.code === "ACCOUNT_LOCKED" && authError.lockedUntil) {
        const lockedUntilDate = new Date(authError.lockedUntil);
        const lockoutTime = Number.isNaN(lockedUntilDate.getTime())
          ? authError.lockedUntil
          : lockedUntilDate.toLocaleString();
        setError(`Account locked until ${lockoutTime}`);
      } else if (
        (authError.code === "CAPTCHA_REQUIRED" ||
          authError.code === "CAPTCHA_INVALID") &&
        !isTurnstileConfigured
      ) {
        setError(
          "Security check is required, but CAPTCHA is not configured. Contact the app administrator.",
        );
      } else {
        setError(authMessage);
      }

      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div
        className="flex flex-1 items-start justify-center px-4 py-12"
        style={{
          paddingTop: "20vh",
        }}
      >
        <div className="flex w-full max-w-5xl items-center gap-12">
          {/* Logo Section */}
          <div className="hidden lg:block flex-shrink-0">
            <div className="relative w-[400px] h-[400px]">
              <Image
                src="/logo-v3.png"
                alt="League Analysis Logo"
                fill
                sizes="300px"
                className="object-contain"
                priority
              />
            </div>
          </div>

          {/* Form Section */}
          <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Sign In</h1>
              <p className="text-gray-600">
                Enter your credentials to access the application
              </p>
            </div>

            <Form {...form}>
              <form
                id="sign-in-form"
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                <FormField
                  control={form.control}
                  name="email"
                  rules={{
                    required: "Email is required",
                    pattern: {
                      value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                      message: "Invalid email address",
                    },
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">Email</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          placeholder="john.doe@email.com"
                          disabled={isSubmitting}
                          className="text-gray-900 border-gray-300 placeholder:text-gray-500 focus-visible:ring-gray-400"
                          style={{ backgroundColor: "#e5e7eb" }}
                          autoComplete="email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  rules={{
                    required: "Password is required",
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700">Password</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder="••••••••"
                          disabled={isSubmitting}
                          className="text-gray-900 border-gray-300 placeholder:text-gray-500 focus-visible:ring-gray-400"
                          style={{ backgroundColor: "#e5e7eb" }}
                          autoComplete="current-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {captchaRequired && (
                  <div className="space-y-2">
                    <FormLabel className="text-gray-700">
                      Security Check
                    </FormLabel>
                    {isTurnstileConfigured ? (
                      <div className="rounded-md border border-gray-200 p-3 bg-gray-50">
                        <Turnstile
                          ref={turnstileRef}
                          siteKey={turnstileSiteKey}
                          onSuccess={(token) => {
                            setCaptchaToken(token);
                          }}
                          onExpire={() => {
                            setCaptchaToken(null);
                          }}
                          onError={() => {
                            setCaptchaToken(null);
                          }}
                          options={{
                            action: "sign_in",
                            theme: "light",
                            size: "flexible",
                            appearance: "interaction-only",
                            refreshExpired: "auto",
                          }}
                        />
                        <p className="text-xs text-gray-500 mt-2">
                          Only shown after repeated failed sign-in attempts.
                        </p>
                      </div>
                    ) : (
                      <Alert variant="destructive">
                        <AlertDescription>
                          CAPTCHA is required for this login, but
                          NEXT_PUBLIC_TURNSTILE_SITE_KEY is not configured.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={
                    isSubmitting || !isFormValid || !isCaptchaSatisfied
                  }
                  className="w-full button-medium"
                >
                  {isSubmitting ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </Form>

            {/* Error message shown below the form to prevent layout shift */}
            <div
              className={`mt-4 transition-all duration-300 ease-in-out overflow-hidden ${
                error ? "max-h-20 opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </div>
      </div>
      <PublicPageFooter />
    </div>
  );
}
