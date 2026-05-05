import { FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { APP_VERSION } from "../version";

export default function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const hydrate = useAuthStore((state) => state.hydrate);
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (isAuthenticated) return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch {
      // The store owns the user-facing error message.
    }
  }

  return (
    <main className="min-h-screen bg-[var(--bg-0)] text-[var(--text-1)]">
      <div className="grid min-h-screen lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative hidden overflow-hidden border-r border-[var(--line)] bg-[var(--bg-1)] p-10 lg:block">
          <div className="relative z-10 flex h-full flex-col">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded bg-[linear-gradient(135deg,#00d084,#00a36a)] text-base font-black text-[var(--bg-0)]">
                <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                  <circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.9" />
                  <circle cx="12" cy="12" r="4" fill="white" opacity="0.6" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--text-0)]">OpenVMS</div>
                <div className="flex items-center gap-2">
                  <div className="mono text-[10px] text-[var(--text-3)]">video management system</div>
                  <span className="mono rounded bg-[var(--bg-3)] px-1 py-px text-[9px] font-semibold text-[var(--acc)]">v{APP_VERSION}</span>
                </div>
              </div>
            </div>

            <div className="mt-auto max-w-xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5 text-xs text-[var(--text-2)]">
                <span className="vms-dot" />
                monitoreo distribuido
              </div>
              <h1 className="m-0 text-4xl font-semibold leading-tight text-[var(--text-0)]">
                Consola operativa para camaras, eventos y playback.
              </h1>
              <p className="mt-4 max-w-lg text-sm leading-6 text-[var(--text-2)]">
                Gestiona Frigate, eventos en tiempo real, exportaciones y usuarios desde una interfaz densa para operacion diaria.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-3 gap-3">
              <LoginMetric label="camaras" value="24" />
              <LoginMetric label="eventos hoy" value="147" />
              <LoginMetric label="latencia" value="12ms" />
            </div>
          </div>
          <div className="absolute inset-0 opacity-70">
            <div className="absolute left-[12%] top-[18%] h-40 w-64 rounded-lg border border-[var(--line)] bg-[var(--bg-2)] shadow-2xl">
              <div className="video-thumb h-full w-full" />
            </div>
            <div className="absolute right-[8%] top-[32%] h-32 w-52 rounded-lg border border-[var(--line)] bg-[var(--bg-2)] shadow-2xl">
              <div className="video-thumb h-full w-full" />
            </div>
            <div className="absolute bottom-[20%] right-[20%] h-28 w-44 rounded-lg border border-[var(--line)] bg-[var(--bg-2)] shadow-2xl">
              <div className="video-thumb h-full w-full" />
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-10">
          <div className="w-full max-w-[390px]">
            <div className="mb-8 lg:hidden">
              <div className="text-sm font-semibold uppercase tracking-wide text-[var(--acc)]">OpenVMS <span className="font-mono text-[var(--text-3)]">v{APP_VERSION}</span></div>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--text-0)]">Iniciar sesion</h1>
            </div>

            <div className="mb-6 hidden lg:block">
              <div className="mono text-[11px] uppercase tracking-[0.12em] text-[var(--acc)]">acceso seguro</div>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--text-0)]">Iniciar sesion</h2>
              <p className="mt-2 text-sm text-[var(--text-2)]">Usa tus credenciales de operador.</p>
            </div>

        <form onSubmit={handleSubmit} className="vms-card space-y-4 p-5">
          <label className="block">
            <span className="text-sm font-medium text-[var(--text-1)]">Usuario</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="admin"
              className="mt-2 h-11 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-[var(--text-1)]">Password</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="admin123"
              className="mt-2 h-11 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none transition focus:border-[var(--acc)]"
              required
            />
          </label>

          {error ? (
            <div className="rounded border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isLoading}
            className="vms-btn primary h-11 w-full disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Entrando..." : "Entrar"}
          </button>
        </form>

            <div className="mt-4 rounded border border-[var(--line)] bg-[var(--bg-1)] px-4 py-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-3)]">default local</span>
                <span className="mono text-[var(--text-1)]">admin / admin123</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function LoginMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--bg-2)] p-3">
      <div className="mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-3)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--text-0)]">{value}</div>
    </div>
  );
}
