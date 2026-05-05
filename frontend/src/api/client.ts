import axios from "axios";

export const apiClient = axios.create({ baseURL: "/api/v1" });

let refreshPromise: Promise<string | null> | null = null;

function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem("access_token", accessToken);
  localStorage.setItem("refresh_token", refreshToken);
}

function clearTokens() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
}

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    if (
      status !== 401 ||
      original?._retry ||
      original?.url === "/auth/login" ||
      original?.url === "/auth/refresh"
    ) {
      return Promise.reject(error);
    }

    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) {
      clearTokens();
      return Promise.reject(error);
    }

    original._retry = true;
    refreshPromise ??= apiClient
      .post("/auth/refresh", { refresh_token: refreshToken })
      .then((response) => {
        const accessToken = response.data.access_token as string;
        const nextRefresh = response.data.refresh_token as string;
        setTokens(accessToken, nextRefresh);
        return accessToken;
      })
      .catch(() => {
        clearTokens();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });

    const accessToken = await refreshPromise;
    if (!accessToken) return Promise.reject(error);

    original.headers.Authorization = `Bearer ${accessToken}`;
    return apiClient(original);
  },
);
