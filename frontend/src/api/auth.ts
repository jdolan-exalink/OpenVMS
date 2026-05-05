import { apiClient } from "./client";

export type UserRole = "admin" | "operator" | "viewer";

export type CurrentUser = {
  id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  created_at: string;
};

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
};

export async function login(username: string, password: string) {
  const { data } = await apiClient.post<TokenResponse>("/auth/login", { username, password });
  return data;
}

export async function logout(refreshToken: string) {
  await apiClient.post("/auth/logout", { refresh_token: refreshToken });
}

export async function getMe() {
  const { data } = await apiClient.get<CurrentUser>("/auth/me");
  return data;
}
