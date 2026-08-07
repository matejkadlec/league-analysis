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
  riot_account_connected: boolean;
  puuid: string | null;
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

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in_seconds: number;
  refresh_expires_in_seconds: number;
}

export interface AuthLoginError extends Error {
  code?: string;
  lockedUntil?: string;
  status?: number;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}
