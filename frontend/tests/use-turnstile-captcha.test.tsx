// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { widgetReset } = vi.hoisted(() => ({ widgetReset: vi.fn<() => void>() }));

// The real widget talks to Cloudflare. This stand-in exposes the three
// callbacks the hook wires (solved, expired, failed) plus the config it must
// pass through, and answers `reset` through the ref the hook keeps.
vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: ({
    ref,
    siteKey,
    options,
    onSuccess,
    onExpire,
    onError,
  }: {
    ref: { current: { reset: () => void } | undefined };
    siteKey: string;
    options: {
      action: string;
      theme: string;
      size: string;
      appearance: string;
      refreshExpired: string;
    };
    onSuccess: (token: string) => void;
    onExpire: () => void;
    onError: () => void;
  }) => {
    ref.current = { reset: widgetReset };
    return (
      <div
        data-testid="turnstile-widget"
        data-sitekey={siteKey}
        data-action={options.action}
        data-theme={options.theme}
        data-size={options.size}
        data-appearance={options.appearance}
        data-refresh-expired={options.refreshExpired}
      >
        <button type="button" onClick={() => onSuccess("token-from-cloudflare")}>
          solve captcha
        </button>
        <button type="button" onClick={onExpire}>
          expire captcha
        </button>
        <button type="button" onClick={onError}>
          fail captcha
        </button>
      </div>
    );
  },
}));

import { useTurnstileCaptcha } from "@/features/auth/components/use-turnstile-captcha";

/** The options object the hook takes, without importing what it does not export. */
type TurnstileCaptchaOptions = Parameters<typeof useTurnstileCaptcha>[0];

/** Renders what the hook returns so its state and widget are both observable. */
function CaptchaHarness(props: TurnstileCaptchaOptions) {
  const captcha = useTurnstileCaptcha(props);
  return (
    <div>
      <p data-testid="token">{captcha.token ?? "none"}</p>
      <p data-testid="configured">{String(captcha.isConfigured)}</p>
      {captcha.widget}
      <button type="button" onClick={() => captcha.reset()}>
        reset captcha
      </button>
    </div>
  );
}

function renderCaptcha(props: Partial<TurnstileCaptchaOptions> = {}) {
  return render(
    <CaptchaHarness
      action="sign-in"
      theme="dark"
      appearance="always"
      {...props}
    />,
  );
}

function tokenText() {
  return screen.getByTestId("token").textContent;
}

beforeEach(() => {
  widgetReset.mockReset();
});

describe("useTurnstileCaptcha", () => {
  it("starts tokenless and reports an unconfigured widget when the env has no site key", () => {
    // An empty `isConfigured` is how both forms know to hide the challenge
    // rather than render a widget that can never be solved.
    renderCaptcha();

    expect(tokenText()).toBe("none");
    expect(screen.getByTestId("configured").textContent).toBe("false");
    // The widget still mounts, handed the empty key rather than crashing.
    expect(screen.getByTestId("turnstile-widget").dataset.sitekey).toBe("");
  });

  it("treats a whitespace-only site key as unconfigured", () => {
    // The key is trimmed before the length check, so a padded env value must
    // not count as configured and hand the widget a blank-looking key.
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "   ");
    renderCaptcha();

    expect(screen.getByTestId("configured").textContent).toBe("false");
    expect(screen.getByTestId("turnstile-widget").dataset.sitekey).toBe("");
  });

  it("holds the token once the visitor solves the challenge", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    const user = userEvent.setup();
    renderCaptcha();

    await user.click(screen.getByRole("button", { name: "solve captcha" }));

    expect(tokenText()).toBe("token-from-cloudflare");
    expect(screen.getByTestId("configured").textContent).toBe("true");
    expect(screen.getByTestId("turnstile-widget").dataset.sitekey).toBe(
      "test-site-key",
    );
  });

  it("drops the token when the challenge expires", async () => {
    // A Turnstile token is single-use and short-lived; an expired one must
    // not survive as state a form would happily resubmit.
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    const user = userEvent.setup();
    renderCaptcha();
    await user.click(screen.getByRole("button", { name: "solve captcha" }));
    expect(tokenText()).toBe("token-from-cloudflare");

    await user.click(screen.getByRole("button", { name: "expire captcha" }));

    expect(tokenText()).toBe("none");
  });

  it("drops the token when the widget errors out", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    const user = userEvent.setup();
    renderCaptcha();
    await user.click(screen.getByRole("button", { name: "solve captcha" }));

    await user.click(screen.getByRole("button", { name: "fail captcha" }));

    expect(tokenText()).toBe("none");
  });

  it("clears the token and asks the widget for a fresh challenge on reset", async () => {
    // After a rejected submission the form resets the captcha: clearing only
    // the token would leave the widget holding its solved state, and only
    // resetting the widget would leave a stale token in the form.
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    const user = userEvent.setup();
    renderCaptcha();
    await user.click(screen.getByRole("button", { name: "solve captcha" }));
    expect(tokenText()).toBe("token-from-cloudflare");

    await user.click(screen.getByRole("button", { name: "reset captcha" }));

    expect(tokenText()).toBe("none");
    expect(widgetReset).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's action, theme, and appearance through to the widget", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    renderCaptcha({ action: "join-us", theme: "light", appearance: "interaction-only" });
    const widget = screen.getByTestId("turnstile-widget");

    expect(widget.dataset.action).toBe("join-us");
    expect(widget.dataset.theme).toBe("light");
    expect(widget.dataset.appearance).toBe("interaction-only");
    // Fixed by the hook, not the caller: the flexible size and the auto
    // refresh of expired challenges.
    expect(widget.dataset.size).toBe("flexible");
    expect(widget.dataset.refreshExpired).toBe("auto");
  });
});
