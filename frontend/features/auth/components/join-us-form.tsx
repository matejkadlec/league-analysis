"use client";

import { useState, type FormEvent } from "react";
import { Users } from "lucide-react";

import {
  apiErrorMessage,
  normalizeApiError,
  unwrap,
  validatedPost,
} from "@/lib/core/api";
import {
  MessageResponseSchema,
  type JoinUsContactRequest,
  type JoinUsSubject,
} from "@/lib/core/schemas";
import { useToast } from "@/lib/core/hooks";
import { cn } from "@/lib/core/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PublicBackButton } from "@/components/public-back-button";
import { PublicPageFooter } from "@/components/public-page-footer";
import { useAuth } from "../context/auth-context";
import { JoinUsRoleCards } from "./join-us-role-cards";
import { useTurnstileCaptcha } from "./use-turnstile-captcha";
import {
  JOIN_US_BODY_MAX_LENGTH,
  JOIN_US_BODY_MIN_LENGTH,
} from "../utils/join-us-message";

const SUBJECT_OPTIONS: { value: JoinUsSubject; label: string }[] = [
  { value: "full_stack_developer", label: "Full-Stack Developer" },
  { value: "beta_tester", label: "Beta Tester" },
  { value: "other", label: "Other" },
];

function resolveApiErrorMessage(error: unknown): string {
  return apiErrorMessage(
    normalizeApiError(error),
    "Your application could not be sent. Please try again later.",
  );
}

interface JoinUsFormProps {
  isAuthenticatedHint?: boolean;
}

export function JoinUsForm({ isAuthenticatedHint = false }: JoinUsFormProps) {
  const toast = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const [subject, setSubject] = useState<JoinUsSubject | "">("");
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const captcha = useTurnstileCaptcha({
    action: "join_us_contact",
    theme: "dark",
    appearance: "always",
  });

  const trimmedBody = body.trim();
  const bodyLength = trimmedBody.length;
  const remainingChars = Math.max(0, JOIN_US_BODY_MIN_LENGTH - bodyLength);
  const isSubjectValid = subject !== "";
  const isBodyValid = bodyLength >= JOIN_US_BODY_MIN_LENGTH;
  const isCaptchaSatisfied =
    !captcha.isConfigured ||
    (captcha.token !== null && captcha.token.length > 0);
  const canSubmit = isSubjectValid && isBodyValid && isCaptchaSatisfied;
  const isAuthenticatedForBackButton =
    isAuthenticated || (isLoading && isAuthenticatedHint);
  const backButtonHref = isAuthenticatedForBackButton ? "/" : "/sign-in";
  const backButtonLabel = isAuthenticatedForBackButton
    ? "Back to Home page"
    : "Back to Sign In page";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || isSubmitting) {
      return;
    }

    const selectedSubject = subject as JoinUsSubject;

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      unwrap(
        await validatedPost(MessageResponseSchema, "/auth/join-us/contact", {
          subject: selectedSubject,
          body: trimmedBody,
          captcha_token: captcha.token,
        } satisfies JoinUsContactRequest),
      );

      toast.success("Application sent", {
        description: "Thank you for reaching out. We will review your message.",
      });

      setSubject("");
      setBody("");
      captcha.reset();
    } catch (error) {
      const message = resolveApiErrorMessage(error);
      setSubmitError(message);
      captcha.reset();
      toast.error("Could not send your application", {
        description: message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative flex-1 px-4 pb-16 pt-16">
        <PublicBackButton href={backButtonHref} label={backButtonLabel} />

        <div className="mx-auto flex w-full max-w-300 flex-col gap-8 xl:w-3/4">
          <Card className="border-white/15 bg-slate-950/95 text-white shadow-xl">
            <CardHeader className="space-y-3 p-6">
              <CardTitle className="flex items-center gap-3 text-2xl font-semibold">
                <Users className="h-6 w-6 text-amber-400" />
                Join League Analysis
              </CardTitle>
              <CardDescription className="text-sm text-white/80">
                We are actively looking for volunteer full-stack developers and
                beta testers who want to build better League analytics with us.
              </CardDescription>
            </CardHeader>
          </Card>

          <JoinUsRoleCards />

          <div className="mx-auto w-full max-w-3xl">
            <Card className="border-white/15 bg-slate-950/95 text-white shadow-xl">
              <CardHeader>
                <CardTitle className="text-xl">Contact Form</CardTitle>
                <CardDescription className="text-sm text-white/80">
                  Tell us about yourself, your experience, motivation, and why
                  you would be a good fit for the project.
                  <br />
                  Do not describe where you studied or worked, as it is not
                  important. Also no CV required nor wanted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(event) => void handleSubmit(event)}
                  className="space-y-5"
                >
                  <div className="space-y-2">
                    <Label htmlFor="join-us-subject" className="text-white">
                      Subject
                    </Label>
                    <div className="relative">
                      <select
                        id="join-us-subject"
                        value={subject}
                        onChange={(event) =>
                          setSubject(event.target.value as JoinUsSubject | "")
                        }
                        disabled={isSubmitting}
                        className="h-9 w-full appearance-none rounded-md border border-white/25 bg-slate-950 px-3 py-2 pr-10 text-sm text-white shadow-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="" className="bg-slate-950 text-white">
                          Choose an option
                        </option>
                        {SUBJECT_OPTIONS.map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            className="bg-slate-950 text-white"
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/60">
                        ▾
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="join-us-body" className="text-white">
                      Body
                    </Label>
                    <textarea
                      id="join-us-body"
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      disabled={isSubmitting}
                      maxLength={JOIN_US_BODY_MAX_LENGTH}
                      placeholder="Share some info about you, your relevant experience, how you approach collaboration and problem-solving, and why you want to join us."
                      className="min-h-56 w-full resize-y rounded-md border border-white/25 bg-slate-950 px-3 py-2 text-sm text-white shadow-sm outline-none placeholder:text-white/45 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30"
                    />
                    <p
                      className={cn(
                        "text-xs",
                        isBodyValid ? "text-emerald-300" : "text-white/65",
                      )}
                    >
                      {`Message must be at least ${JOIN_US_BODY_MIN_LENGTH} characters.${
                        remainingChars > 0
                          ? ` ${remainingChars} more required.`
                          : " Requirement met."
                      }`}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white">Captcha</Label>
                    {captcha.isConfigured ? (
                      <div className="rounded-md border border-white/20 bg-slate-950/75 p-3">
                        {captcha.widget}
                      </div>
                    ) : (
                      <Alert className="border-amber-400/70 bg-amber-900/35 text-amber-100">
                        <AlertDescription>
                          Captcha is disabled in this environment.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>

                  {submitError && (
                    <Alert className="border-red-500/70 bg-red-950/45 text-red-100">
                      <AlertDescription>{submitError}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={isSubmitting || !canSubmit}
                      className="button-medium no-rotation min-w-50"
                    >
                      {isSubmitting ? "Sending..." : "Submit"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <PublicPageFooter />
    </div>
  );
}
