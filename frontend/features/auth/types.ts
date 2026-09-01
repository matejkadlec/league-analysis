import type { UserResponse } from "@/lib/core/schemas";

/**
 * The signed-in user record. Aliased to the schema type, never hand-written:
 * that is what keeps `GET /auth/me` zod-parsed before it reaches React state.
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
  /**
   * Awaited, not fire-and-forget: only the server can revoke. Without the flag
   * an unreachable server leaves local state intact -- pass it from a click.
   */
  logout: (options?: {
    evenIfTheServerCannotBeReached?: boolean;
  }) => Promise<void>;
  checkAuth: () => Promise<void>;
}
