import { create } from "zustand";
import * as authApi from "../api/auth";
import type { CurrentUser } from "../api/auth";

type AuthState = {
  user: CurrentUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  hydrate: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearSession: () => void;
};

function readToken(key: string) {
  return localStorage.getItem(key);
}

function writeTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem("access_token", accessToken);
  localStorage.setItem("refresh_token", refreshToken);
}

function clearTokens() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: readToken("access_token"),
  refreshToken: readToken("refresh_token"),
  isLoading: false,
  error: null,
  isAuthenticated: Boolean(readToken("access_token")),

  hydrate: async () => {
    if (!readToken("access_token")) {
      set({ user: null, isAuthenticated: false });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const user = await authApi.getMe();
      set({
        user,
        accessToken: readToken("access_token"),
        refreshToken: readToken("refresh_token"),
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      clearTokens();
      set({
        user: null,
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const tokens = await authApi.login(username, password);
      writeTokens(tokens.access_token, tokens.refresh_token);
      const user = await authApi.getMe();
      set({
        user,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      const message =
        typeof error === "object" && error !== null && "response" in error
          ? "Credenciales invalidas o cuenta deshabilitada"
          : "No se pudo iniciar sesion";
      set({ error: message, isLoading: false, isAuthenticated: false });
      throw error;
    }
  },

  logout: async () => {
    const refreshToken = get().refreshToken ?? readToken("refresh_token");
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        // Local session is cleared even if server-side revoke fails.
      }
    }
    get().clearSession();
  },

  clearSession: () => {
    clearTokens();
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      error: null,
    });
  },
}));
