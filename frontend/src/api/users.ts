import { apiClient } from "./client";

export type UserRole = "admin" | "operator" | "viewer";

export type User = {
  id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
};

export type UserCreate = {
  username: string;
  password: string;
  email?: string | null;
  full_name?: string | null;
  role?: UserRole;
};

export type UserUpdate = {
  email?: string | null;
  full_name?: string | null;
  role?: UserRole;
  is_active?: boolean;
};

export async function listUsers() {
  const { data } = await apiClient.get<User[]>("/users");
  return data;
}

export async function createUser(body: UserCreate) {
  const { data } = await apiClient.post<User>("/users", body);
  return data;
}

export async function updateUser(id: string, body: UserUpdate) {
  const { data } = await apiClient.put<User>(`/users/${id}`, body);
  return data;
}

export async function deleteUser(id: string) {
  await apiClient.delete(`/users/${id}`);
}
