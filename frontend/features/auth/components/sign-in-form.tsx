"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import Image from "next/image";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/auth-context";
import { getLoginErrorMessage, isAuthLoginError } from "../utils/login-error";
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
import type { LoginCredentials } from "../types";

export function SignInForm() {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const submissionInFlight = useRef(false);
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
    if (submissionInFlight.current) {
      return;
    }

    submissionInFlight.current = true;
    setError(null);
    setIsSubmitting(true);

    try {
      await login({
        ...data,
        captchaToken,
      });
    } catch (err) {
      const authError = isAuthLoginError(err) ? err : null;

      if (
        authError?.code === "CAPTCHA_REQUIRED" ||
        authError?.code === "CAPTCHA_INVALID"
      ) {
        setCaptchaRequired(true);
        setCaptchaToken(null);
        turnstileRef.current?.reset();
      }

      if (authError?.code === "ACCOUNT_LOCKED" && authError.lockedUntil) {
        setError(getLoginErrorMessage(authError));
      } else if (
        (authError?.code === "CAPTCHA_REQUIRED" ||
          authError?.code === "CAPTCHA_INVALID") &&
        !isTurnstileConfigured
      ) {
        setError("Sign-in is temporarily unavailable. Please try again later.");
      } else {
        setError(getLoginErrorMessage(err));
      }

      submissionInFlight.current = false;
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
                onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
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
                      <div className="relative">
                        <FormControl>
                          <Input
                            {...field}
                            type={isPasswordVisible ? "text" : "password"}
                            placeholder="••••••••"
                            disabled={isSubmitting}
                            className="pr-12 text-gray-900 border-gray-300 placeholder:text-gray-500 focus-visible:ring-gray-400"
                            style={{ backgroundColor: "#e5e7eb" }}
                            autoComplete="current-password"
                          />
                        </FormControl>
                        <button
                          type="button"
                          aria-label={
                            isPasswordVisible ? "Hide password" : "Show password"
                          }
                          aria-pressed={isPasswordVisible}
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => setIsPasswordVisible((visible) => !visible)}
                          className="password-visibility-toggle absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-600 hover:text-gray-900"
                        >
                          {isPasswordVisible ? (
                            <EyeOff aria-hidden="true" className="h-4 w-4" />
                          ) : (
                            <Eye aria-hidden="true" className="h-4 w-4" />
                          )}
                        </button>
                      </div>
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
                          Security check is unavailable. Please try again later.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
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
          </div>
        </div>
      </div>
      <PublicPageFooter />
    </div>
  );
}
