"use client";

import { useRef, useState, type FormEvent } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { Code2, Puzzle, UserCheck, Users } from "lucide-react";

import { api, apiErrorMessage, normalizeApiError } from "@/lib/core/api";
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

type JoinUsSubject = "beta_tester" | "full_stack_developer" | "other";

const MESSAGE_MIN_LENGTH = 300;
const NO_LIMIT_TEST_SUFFIX = "#nl";

const SUBJECT_OPTIONS: { value: JoinUsSubject; label: string }[] = [
  { value: "full_stack_developer", label: "Full-Stack Developer" },
  { value: "beta_tester", label: "Beta Tester" },
  { value: "other", label: "Other" },
];

const BETA_REQUIREMENTS = [
  "You actively play League of Legends.",
  "You have a sharp eye for detail, take ownership, and work independently.",
  "You can contribute 5+ hours per week on average.",
  "You are open, communicative, and focus on solutions instead of excuses.",
  "You collaborate well with others and are comfortable asking questions.",
];

const BETA_NICE_TO_HAVE = [
  "Hands-on experience with manual testing or QA.",
  "You know how to write clear, reproducible bug reports.",
  "Experience with JIRA, Confluence and Slack.",
];

const DEVELOPER_REQUIRED = [
  "Python, JavaScript/TypeScript, HTML/CSS, Git, GitHub, and SQL.",
  "You keep up with AI trends and can work with AI coding agents effectively and responsibly.",
];

const DEVELOPER_NICE_TO_HAVE = [
  "FastAPI, Flask, Django, React, Next.js, Node.js, PostgreSQL, SQLAlchemy, and ORMs.",
  "VS Code (or similar IDE), GitHub Copilot (or similar AI assistant), and DbVisualizer (or another DB client).",
  "Linux, Chrome DevTools, DigitalOcean, CI/CD, and SSH.",
  "QA, JIRA, Confluence, and Slack.",
];

const DEVELOPER_DEAL_BREAKER = [
  "You are genuinely interested in League of Legends and data analytics/data science.",
  "You can work independently and as part of a team.",
  "You keep learning, do not give up easily, and think in solutions.",
  "You communicate clearly and understand there are no dumb questions.",
  "You focus on process quality, not just outcomes.",
  "You can bring your own ideas to the project and dedicate around 10+ hours per week on average.",
];

const DEVELOPER_BENEFITS = [
  "Strong internship opportunity (Internship Agreement sign required).",
  "Direct collaboration with an experienced developer (~6 years of work experience) you can learn from.",
  "Hands-on growth across the stack and beyond technical skills.",
  "A way to analyze League of Legends players and meta beyond what common sites show.",
  "Potential future profit, though this should not be your primary motivation.",
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
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const turnstileRef = useRef<TurnstileInstance | undefined>(undefined);
  const turnstileSiteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const isTurnstileConfigured = turnstileSiteKey.length > 0;

  const trimmedBody = body.trim();
  const bodyLength = trimmedBody.length;
  const remainingChars = Math.max(0, MESSAGE_MIN_LENGTH - bodyLength);
  const isNoLimitTestSubmission = trimmedBody
    .toLowerCase()
    .endsWith(NO_LIMIT_TEST_SUFFIX);

  const isSubjectValid = subject !== "";
  const isBodyValid =
    isNoLimitTestSubmission || bodyLength >= MESSAGE_MIN_LENGTH;
  const isCaptchaSatisfied =
    isNoLimitTestSubmission ||
    !isTurnstileConfigured ||
    (captchaToken !== null && captchaToken.length > 0);
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
      await api.post("/auth/join-us/contact", {
        subject: selectedSubject,
        body: trimmedBody,
        captcha_token: captchaToken,
      });

      toast.success("Application sent", {
        description: "Thank you for reaching out. We will review your message.",
      });

      setSubject("");
      setBody("");
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    } catch (error) {
      const message = resolveApiErrorMessage(error);
      setSubmitError(message);
      setCaptchaToken(null);
      turnstileRef.current?.reset();
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
            <Card className="border-white/15 bg-slate-950/95 text-white shadow-xl">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Code2 className="h-5 w-5 text-amber-400" />
                  Full-Stack Developer
                </CardTitle>
                <CardDescription className="text-sm text-white/80">
                  Love-hate League of Legends? Passionate about data and
                  software engineering? Join us.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 text-sm text-white/90">
                <div>
                  <h3 className="mb-2 font-semibold">
                    You must have experience with
                  </h3>
                  <ul className="list-disc space-y-1.5 pl-5 marker:text-amber-400">
                    {DEVELOPER_REQUIRED.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 font-semibold">
                    Nice to have experience with
                  </h3>
                  <ul className="list-disc space-y-1.5 pl-5 marker:text-amber-400">
                    {DEVELOPER_NICE_TO_HAVE.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 font-semibold">The real deal-breaker</h3>
                  <ul className="list-disc space-y-1.5 pl-5 marker:text-amber-400">
                    {DEVELOPER_DEAL_BREAKER.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 font-semibold">Why join us</h3>
                  <ul className="list-disc space-y-1.5 pl-5 marker:text-amber-400">
                    {DEVELOPER_BENEFITS.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <p className="rounded-md border border-red-400/45 bg-red-950/45 p-3 text-xs leading-relaxed text-red-100">
                  Note that the project is currently non-profit and only
                  long-term (3+ months) contributors are welcomed.
                </p>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-6">
              <Card className="border-white/15 bg-slate-950/95 text-white shadow-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <UserCheck className="h-5 w-5 text-amber-400" />
                    Beta Tester
                  </CardTitle>
                  <CardDescription className="text-sm text-white/80">
                    Help us polish the product before wider release.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 text-sm text-white/90">
                  <div>
                    <h3 className="mb-2 font-semibold">Must have</h3>
                    <ul className="list-disc space-y-1.5 pl-5 marker:text-amber-400">
                      {BETA_REQUIREMENTS.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="mb-2 font-semibold">Nice to have</h3>
                    <ul className="list-disc space-y-1.5 pl-5 marker:text-amber-400">
                      {BETA_NICE_TO_HAVE.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <p className="rounded-md border border-amber-300/45 bg-amber-900/35 p-3 text-xs leading-relaxed text-amber-100">
                    The project is currently non-profit. For beta testing,
                    reliable participation matters most; long-term availability
                    is welcome but not strictly required.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-white/15 bg-slate-950/95 text-white shadow-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Puzzle className="h-5 w-5 text-amber-400" />
                    Other
                  </CardTitle>
                  <CardDescription className="text-sm text-white/80">
                    Want to participate, but neither listed position fits you?
                    No problem.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-white/90">
                  <p>
                    Select{" "}
                    <span className="font-semibold text-amber-400">Other</span>{" "}
                    in the contact form below and describe how you would like to
                    contribute.
                  </p>
                  <ul className="list-disc space-y-1.5 pl-5 marker:text-amber-400">
                    <li>Documentation and content improvements.</li>
                    <li>
                      UI/UX feedback, exploratory testing, and bug triage.
                    </li>
                    <li>Data validation, analysis ideas, and process help.</li>
                    <li>Anything else worth of discussion.</li>
                  </ul>
                  <p className="rounded-md border border-white/20 bg-slate-950/70 p-3 text-xs leading-relaxed text-white/80">
                    If you can bring value and communicate clearly, we are open
                    to discussing the role with you.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

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
                    <Label className="text-white">Subject</Label>
                    <div className="relative">
                      <select
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
                    <Label className="text-white">Body</Label>
                    <textarea
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      disabled={isSubmitting}
                      placeholder="Share some info about you, your relevant experience, how you approach collaboration and problem-solving, and why you want to join us."
                      className="min-h-56 w-full resize-y rounded-md border border-white/25 bg-slate-950 px-3 py-2 text-sm text-white shadow-sm outline-none placeholder:text-white/45 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30"
                    />
                    <p
                      className={cn(
                        "text-xs",
                        isBodyValid ? "text-emerald-300" : "text-white/65",
                      )}
                    >
                      {isNoLimitTestSubmission
                        ? "Test mode enabled (#nl detected): minimum length and captcha checks are bypassed."
                        : `Message must be at least ${MESSAGE_MIN_LENGTH} characters.${
                            remainingChars > 0
                              ? ` ${remainingChars} more required.`
                              : " Requirement met."
                          }`}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white">Captcha</Label>
                    {isNoLimitTestSubmission ? (
                      <Alert className="border-sky-400/70 bg-sky-900/30 text-sky-100">
                        <AlertDescription>
                          Test mode is enabled via #nl, so captcha is bypassed
                          for this submission.
                        </AlertDescription>
                      </Alert>
                    ) : isTurnstileConfigured ? (
                      <div className="rounded-md border border-white/20 bg-slate-950/75 p-3">
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
                            action: "join_us_contact",
                            theme: "dark",
                            size: "flexible",
                            appearance: "always",
                            refreshExpired: "auto",
                          }}
                        />
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
