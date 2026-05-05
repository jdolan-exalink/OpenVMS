// liveview-wires.jsx
// LiveView wireframe variations for OpenCCTV VMS
// Each variation is a self-contained component sized for an artboard.
// Variations explore: grid layout, multi-server UX, event feed placement.

// ─────────────────────────────────────────────────────────────
// Shared shop: sketchy primitives reused across artboards.
// ─────────────────────────────────────────────────────────────

function Underline({ children, color = '#1a1a1a', wobble = 2 }) {
  // Hand-drawn underline — short rough stroke under heading text.
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {children}
      <svg
        viewBox="0 0 200 8"
        preserveAspectRatio="none"
        style={{
          position: 'absolute', left: -2, right: -2, bottom: -6,
          width: 'calc(100% + 4px)', height: 6, overflow: 'visible',
        }}
      >
        <path
          d={`M 2 4 Q 50 ${4 - wobble} 100 ${4 + wobble * 0.3} T 198 ${4 - wobble * 0.6}`}
          stroke={color}
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function Squiggle({ w = 60, h = 6, color = '#1a1a1a' }) {
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <path
        d={`M 1 ${h / 2} q ${w / 8} -${h / 2} ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0`}
        stroke={color} strokeWidth="1.4" fill="none" strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowDoodle({ from, to, curve = 0.3, color = '#c96442', label }) {
  // Rough hand-drawn arrow from {x,y} to {x,y} (in artboard coords).
  const [x1, y1] = from;
  const [x2, y2] = to;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const cx = mx + nx * len * curve;
  const cy = my + ny * len * curve;
  // Arrowhead
  const angle = Math.atan2(y2 - cy, x2 - cx);
  const ah = 9;
  const ax1 = x2 - ah * Math.cos(angle - 0.5);
  const ay1 = y2 - ah * Math.sin(angle - 0.5);
  const ax2 = x2 - ah * Math.cos(angle + 0.5);
  const ay2 = y2 - ah * Math.sin(angle + 0.5);
  return (
    <svg className="wf-arrow" style={{ inset: 0, width: '100%', height: '100%' }}>
      <path
        d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
        stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"
      />
      <path
        d={`M ${x2} ${y2} L ${ax1} ${ay1} M ${x2} ${y2} L ${ax2} ${ay2}`}
        stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"
      />
      {label ? (
        <text
          x={cx} y={cy - 4}
          fontFamily="Kalam, Caveat, cursive" fontSize="11" fill={color}
          textAnchor="middle"
        >{label}</text>
      ) : null}
    </svg>
  );
}

function Note({ children, top, left, right, bottom, rotate = 'l', pin = true, hide }) {
  if (hide) return null;
  const cls = 'wf-note ' + (rotate === 'r' ? 'r' : '');
  return (
    <div className={cls} style={{ top, left, right, bottom }}>
      {pin ? <span className="pin" /> : null}
      {children}
    </div>
  );
}

// Sketchy server color chip
function ServerChip({ srv, label, withDot = true, size = 'sm' }) {
  const fontSize = size === 'sm' ? 10 : 11;
  return (
    <span className={`srv-chip srv-${srv}`} style={{ fontSize }}>
      <span className="sw" />
      {withDot ? null : null}
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Camera tile — the X'd box with overlay stuff. Used inside grids.
// ─────────────────────────────────────────────────────────────
function Tile({
  name = 'CAM',
  srv = 'A',
  status = 'live',     // 'live' | 'offline' | 'sub'
  dets = 0,
  audio = false,
  ptz = false,
  ratio = '16/9',
  small = false,
}) {
  const isOff = status === 'offline';
  return (
    <div
      className="wf-x dark"
      style={{
        width: '100%',
        aspectRatio: ratio,
        position: 'relative',
        borderRadius: 4,
        border: '1px solid #2a2f3e',
        overflow: 'hidden',
      }}
    >
      {/* Top-left: server chip + camera name */}
      <div style={{
        position: 'absolute', top: 6, left: 6, right: 6,
        display: 'flex', alignItems: 'center', gap: 5,
        fontFamily: 'var(--mono)', fontSize: small ? 9 : 10, color: '#cfd6e2',
        textShadow: '0 1px 2px rgba(0,0,0,.6)',
      }}>
        <ServerChip srv={srv} label={`SRV-${srv}`} />
        <span style={{
          padding: '1px 5px', borderRadius: 3,
          background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,.15)',
        }}>{name}</span>
        <span style={{ flex: 1 }} />
        {status === 'live' ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 5px', borderRadius: 3,
            background: 'rgba(42,143,95,.25)', color: '#a7d8c2',
            border: '1px solid rgba(42,143,95,.6)',
          }}>
            <span className="wf-dot" style={{ width: 5, height: 5, background: '#2a8f5f', boxShadow: 'none' }} />
            LIVE
          </span>
        ) : status === 'sub' ? (
          <span style={{
            padding: '1px 5px', borderRadius: 3, color: '#cfd6e2',
            background: 'rgba(0,0,0,.5)', border: '1px solid rgba(255,255,255,.15)',
            fontSize: small ? 8 : 9,
          }}>SUB</span>
        ) : (
          <span style={{
            padding: '1px 5px', borderRadius: 3, color: '#e8b9aa',
            background: 'rgba(201,100,66,.15)', border: '1px solid rgba(201,100,66,.6)',
          }}>OFFLINE</span>
        )}
      </div>

      {/* Bottom-left: detection overlay (sketchy box) */}
      {dets > 0 && !isOff ? (
        <>
          <div style={{
            position: 'absolute',
            left: '22%', top: '32%', width: '34%', height: '46%',
            border: '1.4px dashed #2a8f5f',
            borderRadius: 3,
          }}>
            <span style={{
              position: 'absolute', top: -14, left: 0,
              fontFamily: 'var(--mono)', fontSize: 9, color: '#a7d8c2',
              background: 'rgba(13,15,20,.85)', padding: '0 4px', borderRadius: 2,
            }}>person · 0.92</span>
          </div>
          {dets > 1 ? (
            <div style={{
              position: 'absolute',
              left: '60%', top: '50%', width: '24%', height: '30%',
              border: '1.4px dashed #c96442', borderRadius: 3,
            }}>
              <span style={{
                position: 'absolute', top: -14, left: 0,
                fontFamily: 'var(--mono)', fontSize: 9, color: '#e8b9aa',
                background: 'rgba(13,15,20,.85)', padding: '0 4px', borderRadius: 2,
              }}>car · 0.81</span>
            </div>
          ) : null}
        </>
      ) : null}

      {/* PTZ overlay hint */}
      {ptz ? (
        <div style={{
          position: 'absolute', right: 8, bottom: 8,
          width: 32, height: 32, borderRadius: '50%',
          border: '1.2px dashed #a7d8c2', color: '#a7d8c2',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--mono)', fontSize: 9,
        }}>PTZ</div>
      ) : null}

      {/* Audio icon */}
      {audio ? (
        <div style={{
          position: 'absolute', left: 8, bottom: 8,
          padding: '1px 6px', borderRadius: 3,
          background: 'rgba(13,15,20,.7)', border: '1px solid rgba(255,255,255,.12)',
          fontFamily: 'var(--mono)', fontSize: 9, color: '#cfd6e2',
        }}>♪ AUDIO</div>
      ) : null}

      {/* Centered "no signal" for offline */}
      {isOff ? (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--mono)', fontSize: 11, color: '#8a93a3',
        }}>NO SIGNAL</div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sidebar (left nav) — same on every variation, with /live highlighted
// ─────────────────────────────────────────────────────────────
function Sidebar({ width = 180, collapsed = false, onToggle }) {
  const items = [
    ['Dashboard', false, '▦'],
    ['LiveView',  true,  '▤'],
    ['Eventos',   false, '◈'],
    ['Playback',  false, '⏵'],
    ['Frigate',   false, '⚙'],
    ['Settings',  false, '⚙'],
  ];
  const w = collapsed ? 56 : width;
  return (
    <div className="wf-card" style={{
      width: w, height: '100%',
      padding: collapsed ? '14px 6px' : '14px 10px',
      background: 'var(--paper-2)',
      borderRight: '1.5px solid var(--ink)',
      borderRadius: 0,
      boxShadow: 'none',
      display: 'flex', flexDirection: 'column', gap: 14,
      transition: 'width .18s ease',
      position: 'relative',
    }}>
      {/* Logo + collapse toggle */}
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: collapsed ? 0 : 8, padding: '0 4px',
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: 5,
          background: 'var(--accent-fill)', border: '1.4px solid var(--ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--hand)', fontWeight: 700, fontSize: 14, flexShrink: 0,
        }}>◉</div>
        {!collapsed ? <div className="wf-h wf-h-m">OpenCCTV</div> : null}
      </div>

      {/* Collapse handle */}
      <div
        onClick={onToggle}
        style={{
          position: 'absolute', top: 18, right: -10,
          width: 20, height: 20, borderRadius: '50%',
          background: 'var(--paper)', border: '1.4px solid var(--ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer',
          boxShadow: '1px 1px 0 rgba(0,0,0,.08)', zIndex: 3,
          userSelect: 'none',
        }}
        title={collapsed ? 'Expandir' : 'Compactar'}
      >{collapsed ? '›' : '‹'}</div>

      <div className="wf-rule dashed" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!collapsed ? (
          <div className="wf-label" style={{ padding: '0 4px 4px', textTransform: 'uppercase', opacity: .6 }}>navegación</div>
        ) : null}
        {items.map(([label, on, ico]) => (
          <div key={label} className={'wf-nav' + (on ? ' on' : '')}
            style={{
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? '6px 4px' : '6px 10px',
            }}
            title={collapsed ? label : undefined}
          >
            <span className="ico" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--mono)', fontSize: 10, border: 'none',
              width: 16, height: 16,
            }}>{ico}</span>
            {!collapsed ? <span>{label}</span> : null}
            {on && !collapsed ? <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10 }}>●</span> : null}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {!collapsed ? (
          <div className="wf-label" style={{ padding: '0 4px', textTransform: 'uppercase', opacity: .6 }}>servidores</div>
        ) : (
          <div className="wf-label" style={{ textAlign: 'center', opacity: .6, fontSize: 9 }}>SRV</div>
        )}
        {[
          ['A', 'sala-norte', 'green'],
          ['B', 'sala-sur',   'green'],
          ['C', 'remoto-01',  'warn'],
        ].map(([s, n, st]) => (
          collapsed ? (
            <div key={s}
              title={`SRV-${s} · ${n}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '4px 0', borderRadius: 4,
                background: 'var(--paper)',
                border: '1px dashed var(--ink-2)',
                position: 'relative',
              }}>
              <ServerChip srv={s} label={s} />
              <span style={{
                position: 'absolute', top: 2, right: 4,
              }} className={'wf-dot' + (st === 'warn' ? ' warn' : '')} />
            </div>
          ) : (
            <div key={s} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 6px', borderRadius: 4,
              background: 'var(--paper)',
              border: '1px dashed var(--ink-2)',
            }}>
              <ServerChip srv={s} label={`SRV-${s}`} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)' }}>{n}</span>
              <span style={{ marginLeft: 'auto' }} className={'wf-dot' + (st === 'warn' ? ' warn' : '')} />
            </div>
          )
        ))}
      </div>
    </div>
  );
}

// Top header bar shared by all variations
function TopBar({ title = 'LiveView', preset = '3×3', children }) {
  const presets = ['1×1', '2×2', '3×3', '4×4', '2+4', '5×5'];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '10px 16px',
      borderBottom: '1.5px solid var(--ink)',
      background: 'var(--paper)',
    }}>
      <div className="wf-h wf-h-l">
        <Underline>{title}</Underline>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
        <span className="wf-label" style={{ marginRight: 4 }}>layout:</span>
        {presets.map(p => (
          <span key={p} className={'wf-pill' + (p === preset ? ' green' : '')}>{p}</span>
        ))}
      </div>
      <span style={{ flex: 1 }} />
      {children}
      <span className="wf-btn ghost">⊞ multi-cam</span>
      <span className="wf-btn">⏺ rec</span>
      <span className="wf-btn primary">+ asignar</span>
    </div>
  );
}

// Drag-and-drop camera tray (shown along the right or top in some variants)
function CameraTray({ orientation = 'h', cams }) {
  const list = cams || [
    ['A', 'cam-01-norte'],
    ['A', 'cam-02-pasillo'],
    ['B', 'cam-03-sur'],
    ['B', 'cam-04-acceso'],
    ['B', 'cam-05-patio'],
    ['C', 'cam-06-remoto'],
    ['C', 'cam-07-bodega'],
    ['A', 'cam-08-techos'],
  ];
  if (orientation === 'h') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px',
        background: 'var(--paper-2)',
        borderBottom: '1.5px solid var(--ink)',
        overflow: 'hidden',
      }}>
        <span className="wf-label" style={{ textTransform: 'uppercase' }}>cámaras</span>
        <span style={{ width: 1, height: 16, background: 'var(--ink)', opacity: .3 }} />
        {list.map(([s, n]) => (
          <span key={n} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 8px',
            border: '1px dashed var(--ink-2)', borderRadius: 4,
            background: 'var(--paper)',
            fontFamily: 'var(--mono)', fontSize: 10,
          }}>
            <span className={`srv-chip srv-${s}`} style={{ padding: 0, background: 'transparent', border: 0 }}>
              <span className="sw" />
            </span>
            {n}
            <span style={{ color: 'var(--ink-3)' }}>⋮⋮</span>
          </span>
        ))}
        <span style={{ marginLeft: 'auto' }} className="wf-pill ghost">drag al grid →</span>
      </div>
    );
  }
  return (
    <div className="wf-card" style={{
      width: '100%', padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
      background: 'var(--paper-2)', borderRadius: 0, boxShadow: 'none',
      borderTop: 0, borderRight: 0, borderBottom: 0,
    }}>
      <div className="wf-h wf-h-m">Cámaras</div>
      <div className="wf-label">arrastra a una celda</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
        {list.map(([s, n]) => (
          <div key={n} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 6px',
            border: '1px dashed var(--ink-2)', borderRadius: 4,
            background: 'var(--paper)',
            fontFamily: 'var(--mono)', fontSize: 10,
          }}>
            <ServerChip srv={s} label={s} />
            <span>{n}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--ink-3)' }}>⋮⋮</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Event feed — used in multiple variations, both as sidebar and drawer
function EventFeed({ compact = false, header = true, height }) {
  const events = [
    ['A', 'cam-01-norte',  'person',  '0.92', 'hace 12s', 'live'],
    ['B', 'cam-04-acceso', 'car',     '0.88', 'hace 38s', 'live'],
    ['B', 'cam-04-acceso', 'lpr',     'ABC-123', '1m', 'live'],
    ['C', 'cam-06-remoto', 'person',  '0.74', '3m', null],
    ['A', 'cam-02-pasillo','dog',     '0.66', '5m', null],
    ['B', 'cam-05-patio',  'package', '0.81', '8m', null],
    ['A', 'cam-08-techos', 'person',  '0.79', '12m', null],
  ];
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: height || '100%', minHeight: 0,
      background: 'var(--paper)',
    }}>
      {header ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', borderBottom: '1.5px solid var(--ink)',
        }}>
          <div className="wf-h wf-h-m"><Underline>Eventos</Underline></div>
          <span className="wf-pill green"><span className="wf-dot" />WS live</span>
          <span style={{ flex: 1 }} />
          <span className="wf-label">filtro</span>
          <span className="wf-pill ghost">▾ todos</span>
        </div>
      ) : null}

      <div style={{
        flex: 1, overflow: 'hidden', padding: '6px 8px',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {events.slice(0, compact ? 5 : events.length).map(([s, cam, kind, score, when, live], i) => (
          <div key={i} style={{
            display: 'flex', gap: 8, padding: 6,
            border: '1px solid var(--ink)', borderRadius: 5,
            background: live ? 'var(--accent-fill)' : 'var(--paper-2)',
            alignItems: 'flex-start',
          }}>
            <div className="wf-x" style={{
              width: compact ? 44 : 52, height: compact ? 30 : 36,
              borderRadius: 3, flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 10 }}>
                <ServerChip srv={s} label={s} />
                <span style={{ color: 'var(--ink-2)' }}>{cam}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--hand)', fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>{kind}</span>
                <span className="wf-mono">· {score}</span>
              </div>
              <div className="wf-mono" style={{ color: 'var(--ink-3)' }}>{when}</div>
            </div>
            {live ? <span className="wf-dot" style={{ marginTop: 4 }} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers for grid layouts
// ─────────────────────────────────────────────────────────────
function GridArea({ children, gap = 6, style }) {
  return (
    <div style={{
      flex: 1, padding: 10, background: '#0d0f14',
      display: 'flex', flexDirection: 'column', gap, minHeight: 0,
      ...style,
    }}>{children}</div>
  );
}

// ─────────────────────────────────────────────────────────────
// VARIATION A · "Classic" — 3×3 grid, retractable right event feed
// ─────────────────────────────────────────────────────────────
function VariantA({ showAnnotations = true }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar preset="3×3" />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <GridArea>
            {/* 3×3 grid */}
            <div style={{
              flex: 1, display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gridTemplateRows: 'repeat(3, 1fr)',
              gap: 6,
            }}>
              <Tile name="cam-01-norte"   srv="A" dets={2} />
              <Tile name="cam-02-pasillo" srv="A" />
              <Tile name="cam-03-sur"     srv="B" dets={1} audio />
              <Tile name="cam-04-acceso"  srv="B" dets={1} ptz />
              <Tile name="cam-05-patio"   srv="B" />
              <Tile name="cam-06-remoto"  srv="C" status="offline" />
              <Tile name="cam-07-bodega"  srv="C" />
              <Tile name="cam-08-techos"  srv="A" dets={1} />
              <Tile name="cam-09-lobby"   srv="A" />
            </div>
          </GridArea>

          {/* Right: event feed (retractable) */}
          <div style={{
            width: 260, borderLeft: '1.5px solid var(--ink)',
            display: 'flex', flexDirection: 'column',
          }}>
            <EventFeed />
          </div>
        </div>
      </div>

      <Note top={64} left={196} hide={!showAnnotations}>
        layout presets son <b>pills</b> en la barra<br />→ click cambia el grid
      </Note>
      <Note top={300} right={290} rotate="r" hide={!showAnnotations}>
        cada tile lleva <b>chip de servidor</b> +<br />nombre · estado · LIVE/SUB
      </Note>
      <Note bottom={70} right={20} rotate="r" hide={!showAnnotations}>
        feed lateral siempre on,<br />botón ▸ para colapsar
      </Note>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// VARIATION B · "2+4 spotlight" — hero tile + secondary tiles, drawer feed
// ─────────────────────────────────────────────────────────────
function VariantB({ showAnnotations = true }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar preset="2+4">
          <span className="wf-pill ghost">eventos ▾</span>
        </TopBar>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <GridArea>
            <div style={{
              flex: 1, display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr',
              gridTemplateRows: '1fr 1fr',
              gap: 6,
            }}>
              <div style={{ gridRow: '1 / span 2' }}>
                <Tile name="cam-01-norte" srv="A" dets={2} audio ptz />
              </div>
              <Tile name="cam-03-sur"     srv="B" dets={1} />
              <Tile name="cam-04-acceso"  srv="B" dets={1} />
              <Tile name="cam-05-patio"   srv="B" />
              <Tile name="cam-08-techos"  srv="A" dets={1} />
            </div>

            {/* Bottom drawer — collapsed event feed */}
            <div style={{
              height: 120, marginTop: 6,
              background: '#131720', border: '1px solid #2a2f3e',
              borderRadius: 5, display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '6px 10px', borderBottom: '1px solid #2a2f3e',
                display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: 'var(--ui)', fontSize: 11, color: '#cfd6e2',
              }}>
                <span style={{ fontWeight: 600, color: '#e7eaf0' }}>Eventos en vivo</span>
                <span className="wf-pill green"><span className="wf-dot" />WS</span>
                <span style={{ color: '#8a93a3' }}>14 nuevos</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: '#8a93a3' }}>cerrar ▾</span>
              </div>
              <div style={{
                flex: 1, padding: 6, display: 'flex', gap: 6, overflow: 'hidden',
              }}>
                {[
                  ['A', 'cam-01', 'person', '0.92'],
                  ['B', 'cam-04', 'lpr', 'ABC-123'],
                  ['B', 'cam-03', 'car', '0.88'],
                  ['A', 'cam-08', 'person', '0.79'],
                  ['C', 'cam-06', 'pkg', '0.81'],
                ].map(([s, c, k, v], i) => (
                  <div key={i} style={{
                    width: 130, flexShrink: 0,
                    background: '#1a1f2e', border: '1px solid #2a2f3e',
                    borderRadius: 4, padding: 5,
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    <div className="wf-x dark" style={{ height: 38, borderRadius: 3 }} />
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontFamily: 'var(--mono)', fontSize: 9 }}>
                      <ServerChip srv={s} label={s} />
                      <span style={{ color: '#cfd6e2' }}>{c}</span>
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#a7d8c2' }}>{k} · {v}</div>
                  </div>
                ))}
              </div>
            </div>
          </GridArea>
        </div>
      </div>

      <Note top={70} left={420} hide={!showAnnotations}>
        celda <b>hero</b> 2× — doble click<br />en cualquier tile la promueve
      </Note>
      <Note bottom={150} left={196} rotate="r" hide={!showAnnotations}>
        drawer inferior, no ocupa<br />ancho lateral · scroll horizontal
      </Note>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// VARIATION C · "Server-grouped" — tiles agrupados por servidor con headers
// ─────────────────────────────────────────────────────────────
function VariantC({ showAnnotations = true }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar preset="3×3" />
        <CameraTray />

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <GridArea gap={10}>
            {/* Grouped by server */}
            {[
              { srv: 'A', name: 'sala-norte', cams: [
                ['cam-01-norte', 2, false, false],
                ['cam-02-pasillo', 0, false, false],
                ['cam-08-techos', 1, false, false],
              ]},
              { srv: 'B', name: 'sala-sur', cams: [
                ['cam-03-sur', 1, true, false],
                ['cam-04-acceso', 1, false, true],
                ['cam-05-patio', 0, false, false],
              ]},
              { srv: 'C', name: 'remoto-01', cams: [
                ['cam-06-remoto', 0, false, false, 'offline'],
                ['cam-07-bodega', 0, false, false],
              ]},
            ].map(group => (
              <div key={group.srv} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 0',
                  color: '#cfd6e2',
                }}>
                  <ServerChip srv={group.srv} label={`SRV-${group.srv} · ${group.name}`} size="md" />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#8a93a3' }}>
                    {group.cams.length} cám · {group.cams.filter(c => c[4] !== 'offline').length} live
                  </span>
                  <span style={{ flex: 1, height: 1, background: '#2a2f3e' }} />
                  <span style={{ fontFamily: 'var(--label)', fontSize: 10, color: '#8a93a3' }}>contraer ▴</span>
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 6,
                }}>
                  {group.cams.map(([n, d, audio, ptz, st]) => (
                    <Tile key={n} name={n} srv={group.srv} dets={d} audio={audio} ptz={ptz} status={st || 'live'} />
                  ))}
                </div>
              </div>
            ))}
          </GridArea>

          <div style={{
            width: 240, borderLeft: '1.5px solid var(--ink)',
            display: 'flex', flexDirection: 'column',
          }}>
            <EventFeed compact />
          </div>
        </div>
      </div>

      <Note top={104} left={196} hide={!showAnnotations}>
        <b>agrupado por servidor</b> —<br />headers con conteo + colapsar
      </Note>
      <Note top={70} left={500} rotate="r" hide={!showAnnotations}>
        tray superior con cámaras<br />drag → cualquier celda
      </Note>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// VARIATION D · "Map + grid" — mapa de cámaras a la izquierda, grid 4×4
// ─────────────────────────────────────────────────────────────
function VariantD({ showAnnotations = true }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative' }}>
      <Sidebar width={60} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar preset="4×4" />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* LEFT: minimap of camera locations */}
          <div style={{
            width: 220, background: '#131720', borderRight: '1.5px solid var(--ink)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              padding: '8px 10px', borderBottom: '1px solid #2a2f3e',
              fontFamily: 'var(--ui)', fontSize: 11, color: '#e7eaf0', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>Mapa de cámaras</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: '#8a93a3' }}>16 cám</span>
            </div>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              {/* Grid background */}
              <svg style={{ position: 'absolute', inset: 0 }} width="100%" height="100%">
                <defs>
                  <pattern id="mapgrid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#mapgrid)" />
                {/* Floor plan rectangles, hand-sketched feel */}
                <path d="M 20 30 L 200 30 L 200 110 L 130 110 L 130 160 L 200 160 L 200 240 L 20 240 Z"
                  fill="rgba(42,143,95,0.05)" stroke="rgba(207,214,226,.4)" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M 20 30 L 130 30 L 130 110" fill="none" stroke="rgba(207,214,226,.25)" strokeWidth="1" strokeDasharray="3 3" />
              </svg>
              {/* Camera dots */}
              {[
                ['A', 38, 50, 'live'],
                ['A', 80, 90, 'live'],
                ['A', 175, 60, 'sel'],
                ['B', 60, 200, 'live'],
                ['B', 110, 220, 'live'],
                ['B', 180, 200, 'live'],
                ['C', 165, 130, 'off'],
                ['C', 50, 130, 'live'],
              ].map(([srv, x, y, st], i) => {
                const colors = { A: '#2a8f5f', B: '#3b6ec9', C: '#c96442' };
                const isOff = st === 'off';
                const isSel = st === 'sel';
                return (
                  <div key={i} style={{
                    position: 'absolute',
                    left: x - 7, top: y - 7,
                    width: 14, height: 14, borderRadius: '50%',
                    background: isOff ? '#2a2f3e' : colors[srv],
                    border: isSel ? '2px solid #fff' : '2px solid rgba(255,255,255,.6)',
                    boxShadow: isSel ? '0 0 0 4px rgba(255,255,255,.2)' : '0 1px 3px rgba(0,0,0,.5)',
                    opacity: isOff ? 0.5 : 1,
                  }} />
                );
              })}
              {/* Legend */}
              <div style={{
                position: 'absolute', bottom: 8, left: 8, right: 8,
                display: 'flex', gap: 6, flexWrap: 'wrap',
              }}>
                <ServerChip srv="A" label="SRV-A" />
                <ServerChip srv="B" label="SRV-B" />
                <ServerChip srv="C" label="SRV-C" />
              </div>
            </div>
          </div>

          <GridArea>
            {/* 4x4 grid — auto substream */}
            <div style={{
              flex: 1, display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gridTemplateRows: 'repeat(4, 1fr)',
              gap: 4,
            }}>
              {Array.from({ length: 16 }).map((_, i) => {
                const srv = ['A','A','B','B','A','C','B','B','A','B','C','A','B','B','A','C'][i];
                const dets = (i === 2 || i === 7) ? 1 : 0;
                const off = i === 10;
                return (
                  <Tile
                    key={i}
                    name={`cam-${String(i + 1).padStart(2, '0')}`}
                    srv={srv}
                    dets={dets}
                    status={off ? 'offline' : 'sub'}
                    small
                  />
                );
              })}
            </div>
          </GridArea>

          <div style={{
            width: 220, borderLeft: '1.5px solid var(--ink)',
            display: 'flex', flexDirection: 'column',
          }}>
            <EventFeed compact />
          </div>
        </div>
      </div>

      <Note top={110} left={86} hide={!showAnnotations}>
        click en pin del mapa →<br />asigna a celda seleccionada
      </Note>
      <Note top={70} left={420} rotate="r" hide={!showAnnotations}>
        4×4 → todas en <b>SUB</b><br />stream automáticamente
      </Note>
      <Note bottom={20} right={250} hide={!showAnnotations}>
        nav colapsada para<br />maximizar grid
      </Note>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// VARIATION E · "Fullscreen focus" — una cámara expandida con overlays
// ─────────────────────────────────────────────────────────────
function VariantE({ showAnnotations = true }) {
  const [sideCollapsed, setSideCollapsed] = React.useState(false);
  const [eventsOpen, setEventsOpen] = React.useState(false);
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative' }}>
      <Sidebar width={200} collapsed={sideCollapsed} onToggle={() => setSideCollapsed(v => !v)} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px', borderBottom: '1.5px solid var(--ink)',
          background: 'var(--paper)',
        }}>
          <span className="wf-btn ghost">← volver al grid</span>
          <div className="wf-h wf-h-l">
            <Underline>cam-01-norte</Underline>
          </div>
          <ServerChip srv="A" label="SRV-A · sala-norte" size="md" />
          <span className="wf-pill green"><span className="wf-dot" />LIVE · 1080p · WebRTC</span>
          <span style={{ flex: 1 }} />
          <span className="wf-btn ghost">⏵ playback</span>
          <span className="wf-btn ghost">⏺ snapshot</span>
          <span className="wf-btn ghost">audio ♪</span>
          <span
            className={'wf-btn ' + (eventsOpen ? 'primary' : '')}
            onClick={() => setEventsOpen(v => !v)}
            style={{ cursor: 'pointer' }}
          >
            ◈ eventos
            <span className="wf-pill green" style={{
              marginLeft: 4, padding: '0 5px', fontSize: 9,
            }}>14</span>
            <span style={{ marginLeft: 2, fontFamily: 'var(--mono)', fontSize: 10 }}>
              {eventsOpen ? '▸' : '◂'}
            </span>
          </span>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <GridArea>
            <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <Tile name="cam-01-norte" srv="A" dets={2} audio ptz ratio="16/9" />

              {/* PTZ control overlay */}
              <div style={{
                position: 'absolute', right: 16, top: 16,
                width: 130, padding: 10,
                background: 'rgba(13,15,20,.85)',
                border: '1px solid #2a2f3e', borderRadius: 8,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              }}>
                <div style={{ fontFamily: 'var(--ui)', fontSize: 11, color: '#cfd6e2', fontWeight: 600 }}>PTZ</div>
                <div style={{
                  width: 90, height: 90, borderRadius: '50%',
                  border: '1.4px dashed #a7d8c2', position: 'relative',
                }}>
                  {['↑','↓','←','→'].map((a, i) => {
                    const pos = [
                      { top: -8, left: 38 },
                      { bottom: -8, left: 38 },
                      { top: 38, left: -8 },
                      { top: 38, right: -8 },
                    ][i];
                    return (
                      <div key={a} style={{
                        position: 'absolute', ...pos,
                        width: 22, height: 22, borderRadius: '50%',
                        background: '#0d0f14', border: '1px solid #2a8f5f',
                        color: '#a7d8c2', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--mono)', fontSize: 12,
                      }}>{a}</div>
                    );
                  })}
                  <div style={{
                    position: 'absolute', inset: 30,
                    borderRadius: '50%', background: 'rgba(42,143,95,.2)',
                    border: '1px solid #2a8f5f',
                  }} />
                </div>
                <div style={{ display: 'flex', gap: 6, fontFamily: 'var(--mono)', fontSize: 10, color: '#a7d8c2' }}>
                  <span style={{ padding: '2px 6px', border: '1px solid #2a8f5f', borderRadius: 3 }}>− zoom</span>
                  <span style={{ padding: '2px 6px', border: '1px solid #2a8f5f', borderRadius: 3 }}>+</span>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#8a93a3', textAlign: 'center' }}>
                  presets · 1 2 3 4
                </div>
              </div>

              {/* Timeline scrubber along bottom */}
              <div style={{
                position: 'absolute', left: 16, right: 16, bottom: 16,
                background: 'rgba(13,15,20,.85)', border: '1px solid #2a2f3e',
                borderRadius: 6, padding: '6px 10px',
                display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: 'var(--mono)', fontSize: 10, color: '#cfd6e2',
              }}>
                <span style={{ color: '#a7d8c2' }}>● LIVE</span>
                <span style={{ color: '#8a93a3' }}>14:32:06</span>
                <div style={{
                  flex: 1, height: 6, position: 'relative',
                  background: '#2a2f3e', borderRadius: 3,
                }}>
                  <div style={{
                    position: 'absolute', left: '60%', top: 0, height: '100%',
                    width: '40%', background: '#2a8f5f', borderRadius: 3,
                  }} />
                  {/* Event ticks */}
                  {[15, 32, 48, 72, 88].map(p => (
                    <div key={p} style={{
                      position: 'absolute', left: `${p}%`, top: -3, bottom: -3,
                      width: 1.5, background: '#c96442',
                    }} />
                  ))}
                </div>
                <span>−5m</span>
                <span style={{ color: '#a7d8c2' }}>→ ahora</span>
              </div>
            </div>
          </GridArea>

          <div style={{
            width: eventsOpen ? 280 : 0,
            borderLeft: eventsOpen ? '1.5px solid var(--ink)' : 'none',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            transition: 'width .22s ease',
            position: 'relative',
          }}>
            <div style={{ width: 280, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <EventFeed compact />
            </div>
          </div>
        </div>
      </div>

      <Note top={70} right={400} hide={!showAnnotations}>
        click <b>◈ eventos</b> →<br />despliega panel lateral
      </Note>
      <Note top={20} left={210} rotate="r" hide={!showAnnotations}>
        sidebar <b>compactable</b><br />click en ‹ para colapsar
      </Note>
      <Note bottom={70} left={120} hide={!showAnnotations}>
        timeline con marcadores<br />de eventos en rojo
      </Note>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TABLET · LiveView en tablet (orientación horizontal)
// ─────────────────────────────────────────────────────────────
function VariantTablet({ showAnnotations = true }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, position: 'relative',
      background: 'var(--paper-2)',
    }}>
      <div className="wf-tablet" style={{ width: '100%', height: '100%' }}>
        <div className="screen" style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Tablet top bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', borderBottom: '1px solid #2a2f3e',
            fontFamily: 'var(--ui)', fontSize: 11, color: '#e7eaf0',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: 5,
              background: '#2a8f5f',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#0d0f14', fontWeight: 700, fontSize: 13,
            }}>◉</div>
            <span style={{ fontWeight: 600 }}>LiveView</span>
            <span style={{ fontSize: 10, color: '#8a93a3' }}>· 9 cám · 3 srv</span>
            <span style={{ flex: 1 }} />
            {/* Layout pills */}
            {['1×1', '2×2', '3×3'].map((p, i) => (
              <span key={p} style={{
                padding: '3px 9px', borderRadius: 4,
                background: i === 1 ? '#2a8f5f' : 'transparent',
                color: i === 1 ? '#0d0f14' : '#cfd6e2',
                fontFamily: 'var(--ui)', fontSize: 11, fontWeight: i === 1 ? 600 : 400,
                border: '1px solid ' + (i === 1 ? '#2a8f5f' : '#2a2f3e'),
              }}>{p}</span>
            ))}
            <span style={{ width: 10 }} />
            <span style={{
              padding: '3px 9px', borderRadius: 4,
              border: '1px solid #2a2f3e', color: '#cfd6e2',
            }}>eventos</span>
          </div>

          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Left: tap-to-assign camera tray */}
            <div style={{
              width: 130, borderRight: '1px solid #2a2f3e',
              padding: 8, display: 'flex', flexDirection: 'column', gap: 5,
              background: '#131720', overflow: 'hidden',
            }}>
              <div style={{
                fontFamily: 'var(--ui)', fontSize: 10, color: '#8a93a3',
                textTransform: 'uppercase', letterSpacing: '.05em', padding: '0 2px 2px',
              }}>tap p/ asignar</div>
              {[
                ['A', 'cam-01', 'live'],
                ['A', 'cam-02', 'live'],
                ['B', 'cam-03', 'live'],
                ['B', 'cam-04', 'sel'],
                ['B', 'cam-05', 'live'],
                ['C', 'cam-06', 'off'],
                ['C', 'cam-07', 'live'],
                ['A', 'cam-08', 'live'],
              ].map(([s, n, st], i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 6px', borderRadius: 4,
                  background: st === 'sel' ? 'rgba(42,143,95,.18)' : '#1a1f2e',
                  border: '1px solid ' + (st === 'sel' ? '#2a8f5f' : '#2a2f3e'),
                  fontFamily: 'var(--mono)', fontSize: 10, color: '#cfd6e2',
                }}>
                  <ServerChip srv={s} label={s} />
                  <span>{n}</span>
                  <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%',
                    background: st === 'off' ? '#8a93a3' : '#2a8f5f' }} />
                </div>
              ))}
            </div>

            {/* Grid 2×2 */}
            <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{
                flex: 1, display: 'grid',
                gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 6,
              }}>
                <Tile name="cam-01-norte"   srv="A" dets={1} />
                <Tile name="cam-03-sur"     srv="B" />
                <Tile name="cam-04-acceso"  srv="B" dets={1} ptz />
                <Tile name="cam-08-techos"  srv="A" />
              </div>

              {/* Bottom touch bar */}
              <div style={{
                display: 'flex', gap: 6,
                padding: '6px 8px', background: '#131720',
                borderRadius: 6, border: '1px solid #2a2f3e',
                alignItems: 'center', fontFamily: 'var(--ui)', fontSize: 11, color: '#cfd6e2',
              }}>
                <span style={{ padding: '5px 12px', borderRadius: 4, background: '#0d0f14', border: '1px solid #2a2f3e' }}>⏪ −10s</span>
                <span style={{ padding: '5px 12px', borderRadius: 4, background: '#0d0f14', border: '1px solid #2a2f3e' }}>⏵</span>
                <span style={{ padding: '5px 12px', borderRadius: 4, background: '#0d0f14', border: '1px solid #2a2f3e' }}>⏩ +10s</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: '#a7d8c2' }}>● LIVE</span>
                <span style={{ width: 10 }} />
                <span style={{ padding: '5px 14px', borderRadius: 4, background: '#2a8f5f', color: '#0d0f14', fontWeight: 600 }}>⤢ pleno</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Note top={36} right={20} rotate="r" hide={!showAnnotations}>
        tablet horizontal · presets<br />reducidos a 1×1 / 2×2 / 3×3
      </Note>
      <Note bottom={36} left={20} hide={!showAnnotations}>
        <b>tap</b> reemplaza drag —<br />selecciona celda → tap cám
      </Note>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Cover artboard — title + key for the canvas
// ─────────────────────────────────────────────────────────────
function CoverBoard() {
  return (
    <div style={{
      width: '100%', height: '100%', padding: 32,
      background: 'var(--paper)',
      display: 'flex', flexDirection: 'column', gap: 20,
    }}>
      <div style={{ fontFamily: 'var(--hand)', fontSize: 14, color: 'var(--ink-3)' }}>
        OpenCCTV VMS · wireframes
      </div>
      <div style={{ fontFamily: 'var(--hand)', fontSize: 38, fontWeight: 700, lineHeight: 1.05 }}>
        <Underline color="#2a8f5f" wobble={3}>LiveView</Underline>
        <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> — explorando</span>
      </div>
      <div style={{ fontFamily: 'var(--hand)', fontSize: 18, color: 'var(--ink-2)', lineHeight: 1.4, maxWidth: 560 }}>
        Cinco direcciones para el grid en vivo, una vista tablet,
        y la pregunta principal: <b>¿cómo se identifica el servidor</b> en cada
        cámara y evento <b>cuando hay tres servidores Frigate</b> mezclados?
      </div>

      <div className="wf-rule dashed" style={{ marginTop: 8 }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 4 }}>
        <div>
          <div className="wf-h wf-h-m" style={{ marginBottom: 10 }}>
            <Underline>Variantes</Underline>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, fontFamily: 'var(--hand)', fontSize: 14 }}>
            <li><b>A · Clásico</b> — 3×3 · feed lateral · server-chip por tile</li>
            <li><b>B · Spotlight</b> — 2+4 · drawer inferior horizontal</li>
            <li><b>C · Agrupado</b> — tiles agrupados por servidor</li>
            <li><b>D · Mapa</b> — minimapa lateral · 4×4 substream</li>
            <li><b>E · Fullscreen</b> — celda expandida · PTZ · timeline</li>
            <li><b>Tablet</b> — tap-to-assign · controles touch</li>
          </ul>
        </div>
        <div>
          <div className="wf-h wf-h-m" style={{ marginBottom: 10 }}>
            <Underline>Vocabulario</Underline>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: 'var(--hand)', fontSize: 13 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ServerChip srv="A" label="SRV-A" />
              <ServerChip srv="B" label="SRV-B" />
              <ServerChip srv="C" label="SRV-C" />
              <span style={{ color: 'var(--ink-3)' }}>color por servidor</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="wf-pill green"><span className="wf-dot" />LIVE</span>
              <span className="wf-pill"><span className="wf-dot off" />SUB</span>
              <span className="wf-pill warn"><span className="wf-dot warn" />OFFLINE</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="wf-btn">botón</span>
              <span className="wf-btn primary">primario</span>
              <span className="wf-btn ghost">ghost</span>
            </div>
            <div className="wf-mono" style={{ color: 'var(--ink-3)' }}>
              JetBrains Mono → datos · Inter → UI · Kalam → notas
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Expose to window for app.jsx to consume
Object.assign(window, {
  VariantA, VariantB, VariantC, VariantD, VariantE, VariantTablet,
  CoverBoard,
});
