import { Code2, Puzzle, UserCheck } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

export function JoinUsRoleCards() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      <Card className="border-white/15 bg-slate-950/95 text-white shadow-xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Code2 className="h-5 w-5 text-amber-400" />
            Full-Stack Developer
          </CardTitle>
          <CardDescription className="text-sm text-white/80">
            Love-hate League of Legends? Passionate about data and software
            engineering? Join us.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm text-white/90">
          <div>
            <h3 className="mb-2 font-semibold">You must have experience with</h3>
            <ul className="list-disc space-y-1.5 pl-5 marker:text-amber-400">
              {DEVELOPER_REQUIRED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Nice to have experience with</h3>
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
            Note that the project is currently non-profit and only long-term
            (3+ months) contributors are welcomed.
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
              The project is currently non-profit. For beta testing, reliable
              participation matters most; long-term availability is welcome but
              not strictly required.
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
              Want to participate, but neither listed position fits you? No
              problem.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-white/90">
            <p>
              Select{" "}
              <span className="font-semibold text-amber-400">Other</span> in the
              contact form below and describe how you would like to contribute.
            </p>
            <ul className="list-disc space-y-1.5 pl-5 marker:text-amber-400">
              <li>Documentation and content improvements.</li>
              <li>UI/UX feedback, exploratory testing, and bug triage.</li>
              <li>Data validation, analysis ideas, and process help.</li>
              <li>Anything else worth of discussion.</li>
            </ul>
            <p className="rounded-md border border-white/20 bg-slate-950/70 p-3 text-xs leading-relaxed text-white/80">
              If you can bring value and communicate clearly, we are open to
              discussing the role with you.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
