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
      <div className="grid min-h-screen lg:grid-cols-[1.2fr_0.8fr]">

        {/* ── Left hero panel ── */}
        <section className="relative hidden overflow-hidden lg:flex flex-col border-r border-[var(--line)] bg-[var(--bg-1)]">
          {/* top gradient glow */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(0,208,132,0.08),transparent)]" />

          <div className="relative z-10 flex h-full flex-col p-10">
            {/* Logo */}
            <div>
              <img
                src="/openvms-logocompleto.png"
                alt="OpenVMS"
                className="h-10 object-contain object-left"
              />
            </div>

            {/* Headline */}
            <div className="mt-auto max-w-xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5 text-xs text-[var(--text-2)]">
                <span className="vms-dot" />
                monitoreo distribuido · multi-servidor · tiempo real
              </div>
              <h1 className="m-0 text-[2.4rem] font-semibold leading-[1.15] tracking-tight text-[var(--text-0)]">
                Consola operativa para cámaras, eventos y playback.
              </h1>
              <p className="mt-4 max-w-lg text-sm leading-6 text-[var(--text-2)]">
                Gestiona múltiples servidores Frigate, eventos en tiempo real, exportaciones y usuarios desde una interfaz profesional de operación diaria.
              </p>
            </div>

            {/* Metrics */}
            <div className="mt-8 grid grid-cols-3 gap-3">
              <LoginMetric label="Cámaras" value="24" sub="activas" />
              <LoginMetric label="Eventos hoy" value="147" sub="detectados" />
              <LoginMetric label="Latencia" value="12ms" sub="promedio" />
            </div>
          </div>

          {/* Decorative camera feed mockups */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.45]">
            <div className="absolute left-[10%] top-[22%] h-36 w-60 rounded-xl border border-[var(--line)] bg-[var(--bg-2)] shadow-2xl">
              <div className="video-thumb h-full w-full rounded-xl" />
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
                <span className="vms-dot" />
                <span className="mono text-[9px] text-[var(--text-2)]">CAM-01 · LIVE</span>
              </div>
            </div>
            <div className="absolute right-[6%] top-[35%] h-28 w-48 rounded-xl border border-[var(--line)] bg-[var(--bg-2)] shadow-2xl">
              <div className="video-thumb h-full w-full rounded-xl" />
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
                <span className="vms-dot" />
                <span className="mono text-[9px] text-[var(--text-2)]">CAM-04 · LIVE</span>
              </div>
            </div>
            <div className="absolute bottom-[22%] right-[18%] h-24 w-40 rounded-xl border border-[var(--line)] bg-[var(--bg-2)] shadow-2xl">
              <div className="video-thumb h-full w-full rounded-xl" />
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
                <span className="vms-dot warn" />
                <span className="mono text-[9px] text-[var(--text-2)]">CAM-07 · REC</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Right form panel ── */}
        <section className="flex items-center justify-center px-6 py-10 bg-[var(--bg-0)]">
          <div className="w-full max-w-[380px]">

            {/* Mobile logo */}
            <div className="mb-8 lg:hidden">
              <img
                src="/openvms-logocompleto.png"
                alt="OpenVMS"
                className="h-9 object-contain object-left"
              />
            </div>

            {/* Form header */}
            <div className="mb-7">
              <div className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--acc)]">acceso seguro</div>
              <h2 className="mt-2 text-[1.6rem] font-semibold leading-tight text-[var(--text-0)]">Iniciar sesión</h2>
              <p className="mt-1.5 text-sm text-[var(--text-3)]">Ingresa tus credenciales de operador.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">Usuario</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="admin"
                  className="mt-2 h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--bg-1)] px-3.5 text-sm text-[var(--text-0)] outline-none transition-all focus:border-[var(--acc)] focus:shadow-[0_0_0_3px_rgba(0,208,132,0.12)]"
                  required
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-2)]">Contraseña</span>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="mt-2 h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--bg-1)] px-3.5 text-sm text-[var(--text-0)] outline-none transition-all focus:border-[var(--acc)] focus:shadow-[0_0_0_3px_rgba(0,208,132,0.12)]"
                  required
                />
              </label>

              {error ? (
                <div className="rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] px-3.5 py-2.5 text-sm text-[var(--warn)]">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isLoading}
                className="vms-btn primary h-11 w-full text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin" viewBox="0 0 24 24" fill="none" width="15" height="15">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                      <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Entrando...
                  </span>
                ) : "Entrar"}
              </button>
            </form>

            <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--bg-1)] px-4 py-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-3)]">Credenciales por defecto</span>
                <span className="mono font-medium text-[var(--text-1)]">admin / admin123</span>
              </div>
            </div>

            <div className="mt-6 text-center">
              <span className="mono text-[10px] text-[var(--text-3)]">OpenVMS v{APP_VERSION} · Open Source VMS</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function LoginMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-2)] p-3">
      <div className="mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-3)]">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold text-[var(--text-0)]">{value}</div>
      <div className="mt-0.5 text-[10px] text-[var(--text-3)]">{sub}</div>
    </div>
  );
}
