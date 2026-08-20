// Authentication types

export interface User {
  id: number;
  email: string;
  display_name: string;
  is_active: boolean;
  is_admin: boolean;
  email_verified: boolean;
  email_verified_at: string | null;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginRequest extends LoginCredentials {
  captchaToken?: string | null;
}

export interface AuthLoginError extends Error {
  code?: string | undefined;
  lockedUntil?: string | undefined;
  status?: number | undefined;
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
   * server could not be reached -- the safe answer for anything automatic,
   * which is what a timer or an effect will write. Pass the flag only from a
   * control a person just used.
   */
  logout: (options?: {
    evenIfTheServerCannotBeReached?: boolean;
  }) => Promise<void>;
  checkAuth: () => Promise<void>;
}
