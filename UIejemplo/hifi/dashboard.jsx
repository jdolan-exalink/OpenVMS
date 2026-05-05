// dashboard.jsx — VMS Dashboard

function StatCard({ label, value, delta, accent = 'green', trend }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-0)', letterSpacing: '-0.02em' }}>{value}</span>
        {delta ? <span className={'pill ' + accent}>{delta}</span> : null}
      </div>
      {trend ? (
        <svg width="100%" height="32" viewBox="0 0 200 32" preserveAspectRatio="none" style={{ marginTop: 8 }}>
          <defs>
            <linearGradient id={'g-' + label} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent === 'warn' ? '#ff7a59' : '#00d084'} stopOpacity="0.4" />
              <stop offset="100%" stopColor={accent === 'warn' ? '#ff7a59' : '#00d084'} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={trend} fill={`url(#g-${label})`} stroke={accent === 'warn' ? '#ff7a59' : '#00d084'} strokeWidth="1.5" />
        </svg>
      ) : null}
    </div>
  );
}

function DetectionsChart() {
  // Stacked bars: person/car/lpr per hour
  const hours = ['00','03','06','09','12','15','18','21'];
  const data = [
    [8, 3, 1], [4, 2, 0], [6, 5, 2], [22, 18, 4],
    [38, 24, 7], [42, 28, 6], [31, 19, 3], [14, 6, 1],
  ];
  const max = 80;
  return (
    <div className="card">
      <div className="hd">
        <h3>Detecciones por tipo</h3>
        <span className="sp" style={{ flex: 1 }} />
        <span style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-2)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--acc)' }} /> persona
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--info)' }} /> vehículo
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--warn)' }} /> LPR
          </span>
        </span>
        <span className="lbl" style={{ marginLeft: 12 }}>últimas 24h</span>
      </div>
      <div style={{ padding: '20px 16px 8px', display: 'flex', alignItems: 'flex-end',
        gap: 6, height: 180 }}>
        {data.map((d, i) => {
          const total = d[0] + d[1] + d[2];
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <div style={{
                  width: '100%', height: `${(total / max) * 100}%`,
                  display: 'flex', flexDirection: 'column', borderRadius: '4px 4px 0 0', overflow: 'hidden',
                  minHeight: 4,
                }}>
                  <div style={{ background: 'var(--warn)', height: `${(d[2] / total) * 100}%` }} />
                  <div style={{ background: 'var(--info)', height: `${(d[1] / total) * 100}%` }} />
                  <div style={{ background: 'var(--acc)', height: `${(d[0] / total) * 100}%` }} />
                </div>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)' }}>{hours[i]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ServerMap() {
  const cams = [
    ['A', 18, 28, true,  'cam-01-norte'],
    ['A', 38, 22, true,  'cam-02-pasillo'],
    ['A', 56, 38, true,  'cam-08-techos'],
    ['A', 74, 28, true,  'cam-09-lobby'],
    ['B', 24, 62, true,  'cam-03-sur'],
    ['B', 44, 70, true,  'cam-04-acceso'],
    ['B', 64, 64, true,  'cam-05-patio'],
    ['B', 80, 72, true,  'cam-10-deposito'],
    ['C', 88, 48, false, 'cam-06-remoto'],
    ['C', 14, 48, true,  'cam-07-bodega'],
  ];
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="hd">
        <h3>Mapa de cámaras</h3>
        <span style={{ flex: 1 }} />
        <span className="lbl">10 / 24 visibles</span>
        <span className="btn ghost" style={{ marginLeft: 8, fontSize: 11, padding: '4px 8px' }}>plantilla ▾</span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 280, background: '#0a0d12' }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <pattern id="mg" width="5" height="5" patternUnits="userSpaceOnUse">
              <path d="M 5 0 L 0 0 0 5" fill="none" stroke="rgba(255,255,255,.04)" strokeWidth="0.2" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#mg)" />
          {/* Floor plan */}
          <path d="M 8 12 L 84 12 L 84 38 L 60 38 L 60 56 L 84 56 L 84 88 L 8 88 Z"
            fill="rgba(0,208,132,.03)" stroke="rgba(207,214,226,.18)" strokeWidth="0.4" />
          <path d="M 8 38 L 60 38 M 8 56 L 60 56" stroke="rgba(207,214,226,.1)" strokeWidth="0.3" strokeDasharray="1 1" />
        </svg>
        {cams.map((c, i) => {
          const [s, x, y, on, n] = c;
          return (
            <div key={i} style={{
              position: 'absolute', left: `${x}%`, top: `${y}%`,
              transform: 'translate(-50%, -50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            }}>
              <div style={{
                width: 12, height: 12, borderRadius: '50%',
                background: on ? `var(--srv${s})` : 'var(--text-3)',
                border: '2px solid var(--bg-1)',
                boxShadow: on ? `0 0 0 3px rgba(0,208,132,.15), 0 0 12px var(--srv${s})` : 'none',
              }} />
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 9, color: on ? 'var(--text-1)' : 'var(--text-3)',
                background: 'rgba(13,15,20,.85)', padding: '1px 4px', borderRadius: 2,
                whiteSpace: 'nowrap',
              }}>{n.replace('cam-', '')}</span>
            </div>
          );
        })}
        <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6 }}>
          <span className="srvchip A"><span className="sw" />SRV-A · 4</span>
          <span className="srvchip B"><span className="sw" />SRV-B · 4</span>
          <span className="srvchip C"><span className="sw" />SRV-C · 2</span>
        </div>
      </div>
    </div>
  );
}

function RecentEvents() {
  const events = [
    ['14:32:06', 'A', 'cam-01-norte',   'person',  '0.92', null],
    ['14:31:48', 'B', 'cam-04-acceso',  'lpr',     '—',    'ABC-123'],
    ['14:30:22', 'B', 'cam-04-acceso',  'car',     '0.88', null],
    ['14:28:14', 'A', 'cam-08-techos',  'person',  '0.79', null],
    ['14:26:51', 'C', 'cam-07-bodega',  'package', '0.81', null],
    ['14:24:30', 'A', 'cam-02-pasillo', 'person',  '0.74', null],
    ['14:21:08', 'B', 'cam-05-patio',   'dog',     '0.66', null],
  ];
  return (
    <div className="card">
      <div className="hd">
        <h3>Últimos eventos</h3>
        <span className="pill green"><span className="dot green" /> WS live</span>
        <span style={{ flex: 1 }} />
        <span className="lbl">147 hoy</span>
        <span className="btn ghost" style={{ fontSize: 11, padding: '4px 8px', marginLeft: 8 }}>ver todos →</span>
      </div>
      <table className="t">
        <thead>
          <tr>
            <th>Hora</th>
            <th>Servidor</th>
            <th>Cámara</th>
            <th>Tipo</th>
            <th>Score / Placa</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td className="mn" style={{ color: 'var(--text-2)' }}>{e[0]}</td>
              <td><span className={'srvchip ' + e[1]}><span className="sw" />SRV-{e[1]}</span></td>
              <td className="mn">{e[2]}</td>
              <td>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '2px 8px', borderRadius: 4,
                  background: e[3] === 'lpr' ? 'var(--warn-soft)' : 'var(--bg-3)',
                  color: e[3] === 'lpr' ? 'var(--warn)' : 'var(--text-1)',
                  fontSize: 11, fontWeight: 500,
                }}>{e[3]}</span>
              </td>
              <td className="mn" style={{ color: e[5] ? 'var(--warn)' : 'var(--text-1)', fontWeight: e[5] ? 600 : 400 }}>
                {e[5] || e[4]}
              </td>
              <td><span className="btn ghost" style={{ fontSize: 11, padding: '3px 8px' }}>ver clip</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServerStatus() {
  const servers = [
    ['A', 'sala-norte',  '192.168.1.10:5000', 12, 12, true,  '34%', '21%'],
    ['B', 'sala-sur',    '192.168.1.11:5000',  8,  8, true,  '52%', '38%'],
    ['C', 'remoto-01',   'vpn.acme.io:5000',   4,  3, false, '—',   '—'],
  ];
  return (
    <div className="card">
      <div className="hd"><h3>Estado de servidores Frigate</h3></div>
      <table className="t">
        <thead>
          <tr>
            <th>Servidor</th>
            <th>Endpoint</th>
            <th>Cámaras</th>
            <th>Estado</th>
            <th>CPU</th>
            <th>GPU</th>
            <th>Latencia</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {servers.map((s, i) => (
            <tr key={i}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={'srvchip ' + s[0]}><span className="sw" />SRV-{s[0]}</span>
                  <span style={{ color: 'var(--text-1)', fontWeight: 500 }}>{s[1]}</span>
                </div>
              </td>
              <td className="mn" style={{ color: 'var(--text-2)' }}>{s[2]}</td>
              <td className="mn">{s[4]}/{s[3]}</td>
              <td>
                {s[5]
                  ? <span className="pill green"><span className="dot green" />online</span>
                  : <span className="pill warn"><span className="dot warn" />offline</span>}
              </td>
              <td className="mn">{s[6]}</td>
              <td className="mn">{s[7]}</td>
              <td className="mn" style={{ color: s[5] ? 'var(--text-1)' : 'var(--warn)' }}>{s[5] ? '12ms' : 'timeout'}</td>
              <td>
                <span className="btn ghost" style={{ fontSize: 11, padding: '3px 8px' }}>{s[5] ? 'detalles' : 'reconectar'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({ collapsed, onToggle }) {
  const [t1, t2, t3, t4] = [
    'M 0 28 L 18 22 L 36 24 L 54 14 L 72 18 L 90 12 L 108 16 L 126 8 L 144 12 L 162 6 L 180 10 L 200 4 L 200 32 L 0 32 Z',
    'M 0 28 L 18 26 L 36 22 L 54 24 L 72 18 L 90 22 L 108 14 L 126 18 L 144 10 L 162 14 L 180 8 L 200 12 L 200 32 L 0 32 Z',
    'M 0 24 L 18 26 L 36 22 L 54 28 L 72 24 L 90 26 L 108 20 L 126 24 L 144 18 L 162 22 L 180 16 L 200 20 L 200 32 L 0 32 Z',
    'M 0 22 L 18 24 L 36 18 L 54 22 L 72 14 L 90 22 L 108 26 L 126 20 L 144 28 L 162 22 L 180 26 L 200 24 L 200 32 L 0 32 Z',
  ];
  return (
    <div className="vms">
      <Sidebar active="dashboard" collapsed={collapsed} onToggle={onToggle} />
      <div className="main">
        <TopBar title="Dashboard" breadcrumb="resumen general">
          <span className="btn ghost"><span className="dot green" />sistema OK</span>
          <span className="btn">exportar</span>
        </TopBar>
        <div className="content">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 16 }}>
            <StatCard label="Cámaras activas" value="23/24" delta="+1" accent="green" trend={t1} />
            <StatCard label="Eventos hoy"    value="147"   delta="+12%" accent="green" trend={t2} />
            <StatCard label="Detecciones LPR" value="38"   delta="placas"  accent="green" trend={t3} />
            <StatCard label="Alertas críticas" value="3"    delta="−2" accent="warn" trend={t4} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginBottom: 16, minHeight: 320 }}>
            <ServerMap />
            <DetectionsChart />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
            <RecentEvents />
            <ServerStatus />
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Dashboard });
