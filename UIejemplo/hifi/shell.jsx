// shell.jsx — sidebar + topbar + shared atoms

function Sidebar({ active = 'dashboard', collapsed, onToggle }) {
  const nav = [
    ['dashboard',     'Dashboard',     '▦', null],
    ['live',          'LiveView',      '▤', '24'],
    ['eventos',       'Eventos',       '◈', '147'],
    ['playback',      'Playback',      '⏵', null],
    ['frigate',       'Frigate Config','⚒', null],
    ['settings',      'Settings',      '⚙', null],
  ];
  const servers = [
    ['A', 'sala-norte', 12, true],
    ['B', 'sala-sur', 8, true],
    ['C', 'remoto-01', 4, false],
  ];
  return (
    <div className={'sb ' + (collapsed ? 'mini' : 'full')}>
      <div className="brand">
        <div className="lg">◉</div>
        {!collapsed ? (
          <div>
            <div className="nm">OpenVMS</div>
            <div className="ver">v2.4.1</div>
          </div>
        ) : null}
      </div>
      <div className="toggle" onClick={onToggle}>{collapsed ? '›' : '‹'}</div>

      <div className="nav">
        {!collapsed ? <div className="ttl" style={{ marginBottom: 4 }}>navegación</div> : null}
        {nav.map(([k, label, ico, badge]) => (
          <a key={k} className={k === active ? 'on' : ''} title={collapsed ? label : undefined}>
            <span className="ico">{ico}</span>
            <span>{label}</span>
            {badge ? <span className="badge">{badge}</span> : null}
          </a>
        ))}
      </div>

      <div className="srvs">
        {!collapsed ? <div className="ttl">servidores frigate</div> : null}
        {servers.map(([s, n, c, online]) => (
          <div key={s} className={'srv ' + (online ? '' : 'warn')} title={collapsed ? `SRV-${s} · ${n}` : undefined}>
            <span className="sw" style={{ background: `var(--srv${s})` }} />
            <span className="nm">SRV-{s}</span>
            {!collapsed ? <span className="lat">{c}cm · {online ? '12ms' : 'off'}</span> : null}
            <span className={'dot ' + (online ? '' : 'warn')} style={collapsed ? { marginLeft: 0 } : {}} />
          </div>
        ))}
      </div>

      <div className="usr">
        <div className="av">JM</div>
        {!collapsed ? (
          <div>
            <div className="nm">jmartinez</div>
            <div className="role">admin</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TopBar({ title, breadcrumb, children }) {
  return (
    <div className="tb">
      <h1>{title}</h1>
      {breadcrumb ? <span className="breadcrumb">/ {breadcrumb}</span> : null}
      <span className="sp" />
      {children}
      <div className="search">
        <span style={{ fontFamily: 'var(--mono)' }}>⌕</span>
        <span>Buscar cámara, evento, placa…</span>
        <span className="sp" />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)' }}>⌘K</span>
      </div>
      <div className="ic-btn">◈<div className="pip" /></div>
      <div className="ic-btn">⚙</div>
    </div>
  );
}

// Camera tile / video placeholder
function VTile({ name, srv = 'A', live = true, dets = [], small = false, height, audio, ratio = '16/9' }) {
  return (
    <div className="vtile" style={{ width: '100%', height: height || 'auto', aspectRatio: !height ? ratio : undefined }}>
      <div className="ovl" style={{
        background: 'radial-gradient(ellipse at 60% 60%, rgba(255,255,255,.03), transparent 70%)',
      }} />
      <div className="top">
        <span className={'srvchip ' + srv}><span className="sw" />SRV-{srv}</span>
        <span className="nm">{name}</span>
        <span style={{ flex: 1 }} />
        {live ? <span className="live">● LIVE</span> :
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--warn)',
            background: 'rgba(0,0,0,.6)', padding: '1px 6px', borderRadius: 3,
          }}>OFFLINE</span>}
      </div>
      {dets.map((d, i) => (
        <div key={i} className="det-box" style={{
          left: `${d.x}%`, top: `${d.y}%`, width: `${d.w}%`, height: `${d.h}%`,
          borderColor: d.k === 'car' ? 'var(--warn)' : 'var(--acc)',
        }}>
          <span className="lbl" style={{ background: d.k === 'car' ? 'var(--warn)' : 'var(--acc)' }}>
            {d.k} · {d.s}
          </span>
        </div>
      ))}
      {audio ? (
        <div className="bot">
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 10, color: '#fff',
            background: 'rgba(0,0,0,.6)', padding: '1px 6px', borderRadius: 3,
          }}>♪ audio</span>
        </div>
      ) : null}
    </div>
  );
}

Object.assign(window, { Sidebar, TopBar, VTile });
