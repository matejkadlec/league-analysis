// Authentication types

import type { UserResponse } from "@/lib/core/schemas";

/**
 * The signed-in user record, as the API declares it. Hand-written fields here
 * left `GET /auth/me` the one response reaching React state without a zod
 * parse, so a renamed backend field landed as garbage in silence.
 */
export type User = UserResponse;

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginRequest extends LoginCredentials {
  captchaToken?: string | null;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  // Awaited, not fire-and-forget: only the server can revoke, so callers that
  // act on the result -- the "can't reach the server" escape hatch -- need to
  // know when the request has actually come back.
  /**
   * Ends the session. Without the flag this changes nothing locally when the
   * server could not be reached -- the safe answer for anything automatic.
   * Pass the flag only from a control a person just used.
   */
  logout: (options?: {
    evenIfTheServerCannotBeReached?: boolean;
  }) => Promise<void>;
  checkAuth: () => Promise<void>;
}
