"use client";

import { type ReactNode, useRef, useState } from "react";
import { type Control, useForm } from "react-hook-form";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/auth-context";
import { useTurnstileCaptcha } from "./use-turnstile-captcha";
import { getLoginErrorMessage, isAuthLoginError } from "@/lib/session/login-error";
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

// Not shared with settings' PasswordInput: that one wraps a plain Input, this
// needs react-hook-form's FormField.
function PasswordField({
  control,
  isSubmitting,
}: {
  control: Control<LoginCredentials>;
  isSubmitting: boolean;
}) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  return (
    <FormField
      control={control}
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
              aria-label={isPasswordVisible ? "Hide password" : "Show password"}
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
  );
}

function CaptchaSection({
  isConfigured,
  widget,
}: {
  isConfigured: boolean;
  widget: ReactNode;
}) {
  return (
    <div className="space-y-2">
      {/* A heading, not a form field: there is no control to label, and a
          FormLabel would point `htmlFor` at an id nothing renders. */}
      <p
        id="sign-in-captcha-heading"
        className="text-sm font-medium leading-none text-gray-700"
      >
        Security Check
      </p>
      {isConfigured ? (
        <div
          role="group"
          aria-labelledby="sign-in-captcha-heading"
          className="rounded-md border border-gray-200 p-3 bg-gray-50"
        >
          {widget}
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
  );
}

export function SignInForm() {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const submissionInFlight = useRef(false);
  const captcha = useTurnstileCaptcha({
    action: "sign_in",
    theme: "light",
    appearance: "interaction-only",
  });

  const form = useForm<LoginCredentials>({
    defaultValues: {
      email: "",
      password: "",
    },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });

  // oxlint-disable-next-line react/incompatible-library -- React Hook Form watch() is intentionally not memoizable
  const email = form.watch("email");
  const password = form.watch("password");
  const isFormValid = email.trim().length > 0 && password.trim().length > 0;
  const isCaptchaSatisfied =
    !captchaRequired || (captcha.isConfigured && captcha.token !== null);

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
        captchaToken: captcha.token,
      });
    } catch (err) {
      const authError = isAuthLoginError(err) ? err : null;
      const isCaptchaError =
        authError?.code === "CAPTCHA_REQUIRED" ||
        authError?.code === "CAPTCHA_INVALID";

      if (isCaptchaError) {
        setCaptchaRequired(true);
        captcha.reset();
      }

      // Only the unconfigured-captcha case needs its own text: every other
      // code, ACCOUNT_LOCKED included, already has an answer in the table.
      setError(
        isCaptchaError && !captcha.isConfigured
          ? "Sign-in is temporarily unavailable. Please try again later."
          : getLoginErrorMessage(err),
      );
    } finally {
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

                <PasswordField
                  control={form.control}
                  isSubmitting={isSubmitting}
                />

                {captchaRequired && (
                  <CaptchaSection
                    isConfigured={captcha.isConfigured}
                    widget={captcha.widget}
                  />
                )}

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button
                  type="submit"
                  disabled={isSubmitting || !isFormValid || !isCaptchaSatisfied}
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
