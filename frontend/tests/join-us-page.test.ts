import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The page is a redirect while Riot production-key review is pending, so the
 * destination is the whole observable behaviour. `redirect` is mocked to
 * throw the way the real one does, so the destination is observable.
 */

type CookieStore = {
  get: (name: string) => { name: string; value: string } | undefined;
};

const { cookies, redirect } = vi.hoisted(() => ({
  cookies: vi.fn<() => Promise<CookieStore>>(),
  redirect: vi.fn<(url: string) => never>(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("next/navigation", () => ({ redirect }));

import JoinUsPage from "@/app/join-us/page";
import {
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_VALUE,
} from "@/lib/session/auth-state-cookie";

const jar = new Map<string, string>();

beforeEach(() => {
  jar.clear();
  redirect.mockReset();
  // The real `redirect` throws `NEXT_REDIRECT`; throwing both matches it and
  // stops the page where the framework would.
  redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  });
  cookies.mockImplementation(async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
  }));
});

describe("the join-us page", () => {
  it("sends a signed-out visitor to sign-in", async () => {
    await expect(JoinUsPage()).rejects.toThrow(/^NEXT_REDIRECT \/sign-in$/);
    expect(redirect.mock.calls).toEqual([["/sign-in"]]);
  });

  it("sends a signed-in visitor home instead", async () => {
    jar.set(AUTH_STATE_COOKIE_NAME, AUTH_STATE_COOKIE_VALUE);

    await expect(JoinUsPage()).rejects.toThrow(/^NEXT_REDIRECT \/$/);
    expect(redirect.mock.calls).toEqual([["/"]]);
  });
});
