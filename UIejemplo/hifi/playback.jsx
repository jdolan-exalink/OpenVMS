// playback.jsx — VMS Playback page (multi-cam sync + timeline)

function Timeline({ cam, srv, events, hr = 24 }) {
  // events: [{t: 0..1, kind}]
  const recordingBlocks = [
    [0.00, 0.18], [0.22, 0.45], [0.48, 0.62], [0.65, 0.88], [0.90, 1.00],
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      borderBottom: '1px solid var(--line-2)',
    }}>
      <span className={'srvchip ' + srv} style={{ flexShrink: 0 }}><span className="sw" />SRV-{srv}</span>
      <span className="mn" style={{ color: 'var(--text-1)', minWidth: 120, fontSize: 11 }}>{cam}</span>
      <div style={{ flex: 1, position: 'relative', height: 28, background: 'var(--bg-0)', borderRadius: 4, overflow: 'hidden' }}>
        {/* recording blocks */}
        {recordingBlocks.map(([a, b], i) => (
          <div key={i} style={{
            position: 'absolute', left: `${a * 100}%`, width: `${(b - a) * 100}%`,
            top: 0, bottom: 0, background: 'rgba(0,208,132,.18)',
            borderLeft: '1px solid var(--acc)', borderRight: '1px solid var(--acc)',
          }} />
        ))}
        {/* event markers */}
        {events.map((e, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${e.t * 100}%`,
            top: 0, bottom: 0, width: 2,
            background: e.kind === 'lpr' ? 'var(--warn)' : e.kind === 'car' ? 'var(--info)' : 'var(--acc-strong)',
            boxShadow: e.kind === 'lpr' ? '0 0 6px var(--warn)' : '0 0 4px rgba(255,255,255,.4)',
          }} title={e.kind} />
        ))}
        {/* current playhead */}
        <div style={{
          position: 'absolute', left: '52%', top: -2, bottom: -2, width: 2,
          background: '#fff', boxShadow: '0 0 8px rgba(255,255,255,.8)', zIndex: 2,
        }} />
      </div>
      <span className="mn" style={{ color: 'var(--text-3)', fontSize: 10, flexShrink: 0 }}>
        {recordingBlocks.length} bloques · {events.length} ev
      </span>
    </div>
  );
}

function Playback({ collapsed, onToggle }) {
  const cams = [
    { srv: 'A', cam: 'cam-01-norte',   audio: true,  dets: [{ x: 22, y: 32, w: 28, h: 50, k: 'person', s: '0.92' }] },
    { srv: 'B', cam: 'cam-04-acceso',  audio: false, dets: [{ x: 30, y: 38, w: 26, h: 36, k: 'car', s: '0.88' }] },
    { srv: 'B', cam: 'cam-05-patio',   audio: false, dets: [] },
    { srv: 'A', cam: 'cam-08-techos',  audio: false, dets: [{ x: 50, y: 28, w: 18, h: 42, k: 'person', s: '0.78' }] },
  ];
  const allCams = [
    { srv: 'A', cam: 'cam-01-norte',   ev: [{ t: 0.12, kind: 'person' }, { t: 0.45, kind: 'person' }, { t: 0.78, kind: 'person' }] },
    { srv: 'B', cam: 'cam-04-acceso',  ev: [{ t: 0.08, kind: 'car' }, { t: 0.32, kind: 'lpr' }, { t: 0.52, kind: 'car' }, { t: 0.71, kind: 'lpr' }] },
    { srv: 'B', cam: 'cam-05-patio',   ev: [{ t: 0.20, kind: 'person' }, { t: 0.62, kind: 'dog' }] },
    { srv: 'A', cam: 'cam-08-techos',  ev: [{ t: 0.18, kind: 'person' }, { t: 0.48, kind: 'person' }] },
  ];

  return (
    <div className="vms">
      <Sidebar active="playback" collapsed={collapsed} onToggle={onToggle} />
      <div className="main">
        <TopBar title="Playback" breadcrumb="multi-cámara sincronizada">
          <span className="btn ghost">📋 sesión guardada</span>
          <span className="btn">⤓ exportar clip</span>
        </TopBar>

        {/* date + range selector */}
        <div style={{
          padding: '12px 20px', borderBottom: '1px solid var(--line)',
          background: 'var(--bg-1)', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>fecha</span>
          <span className="btn">📅 27/04/2026</span>
          <span style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginLeft: 8 }}>rango</span>
          <span className="btn">12:00 — 16:00</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>vista:</span>
          {['1×1', '2×2', '1+3', '4×1'].map((p, i) => (
            <span key={p} className={'btn ' + (p === '2×2' ? 'primary' : 'ghost')} style={{ fontSize: 11, padding: '4px 10px' }}>{p}</span>
          ))}
          <span style={{ flex: '0 0 16px' }} />
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>sync:</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 4px 3px 10px', borderRadius: 999, background: 'var(--acc-soft)',
            color: 'var(--acc-strong)', fontSize: 11, fontWeight: 500,
          }}>
            ON
            <span style={{
              width: 22, height: 14, borderRadius: 999, background: 'var(--acc)',
              position: 'relative',
            }}>
              <span style={{
                position: 'absolute', right: 1, top: 1, width: 12, height: 12,
                borderRadius: '50%', background: '#0d0f14',
              }} />
            </span>
          </span>
        </div>

        <div className="content" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 2×2 player grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)',
            gap: 10, flex: '1 1 auto', minHeight: 380, maxHeight: 480,
          }}>
            {cams.map((c, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <VTile name={c.cam} srv={c.srv} live={false} dets={c.dets} audio={c.audio} height="100%" />
                <div style={{
                  position: 'absolute', bottom: 6, right: 6,
                  background: 'rgba(0,0,0,.7)', padding: '2px 8px', borderRadius: 3,
                  fontFamily: 'var(--mono)', fontSize: 10, color: '#fff',
                }}>14:21:34 / 4×</div>
              </div>
            ))}
          </div>

          {/* transport */}
          <div className="card" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="btn ghost" style={{ fontSize: 13, padding: '6px 10px' }}>⏮</span>
            <span className="btn ghost" style={{ fontSize: 13, padding: '6px 10px' }}>⏪ −10s</span>
            <span className="btn primary" style={{ fontSize: 13, padding: '6px 14px' }}>⏵ play</span>
            <span className="btn ghost" style={{ fontSize: 13, padding: '6px 10px' }}>⏩ +10s</span>
            <span className="btn ghost" style={{ fontSize: 13, padding: '6px 10px' }}>⏭</span>

            <span style={{ flex: 1 }} />

            <span className="mn" style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 500 }}>
              <span style={{ color: 'var(--acc)' }}>14:21:34</span> / 16:00:00
            </span>

            <span style={{ flex: 1 }} />

            <span style={{ color: 'var(--text-3)', fontSize: 11 }}>velocidad</span>
            <div style={{ display: 'flex', gap: 0, border: '1px solid var(--line)', borderRadius: 7, overflow: 'hidden' }}>
              {['0.25×', '0.5×', '1×', '2×', '4×'].map((s) => (
                <span key={s} style={{
                  padding: '5px 10px', fontSize: 11, fontFamily: 'var(--mono)',
                  background: s === '4×' ? 'var(--acc)' : 'var(--bg-2)',
                  color: s === '4×' ? '#0d0f14' : 'var(--text-2)',
                  fontWeight: s === '4×' ? 600 : 400, cursor: 'pointer',
                  borderRight: s === '4×' ? 'none' : '1px solid var(--line)',
                }}>{s}</span>
              ))}
            </div>

            <span className="btn ghost" style={{ fontSize: 13, padding: '6px 10px' }}>🔊</span>
          </div>

          {/* timelines per camera */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="hd">
              <h3>Línea de tiempo</h3>
              <span style={{ flex: 1 }} />
              <span style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-2)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 4, background: 'rgba(0,208,132,.4)', border: '1px solid var(--acc)', borderRadius: 1 }} /> grabación
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 2, height: 10, background: 'var(--acc-strong)' }} /> persona
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 2, height: 10, background: 'var(--info)' }} /> vehículo
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 2, height: 10, background: 'var(--warn)' }} /> LPR
                </span>
              </span>
              <span className="lbl" style={{ marginLeft: 12 }}>12:00 → 16:00</span>
            </div>
            <div>
              {/* hour scale */}
              <div style={{
                display: 'flex', padding: '6px 12px 0', position: 'relative',
                fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)',
              }}>
                <span style={{ width: 130, flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', padding: '0 0 4px' }}>
                  {['12:00','13:00','14:00','15:00','16:00'].map(h => <span key={h}>{h}</span>)}
                </div>
                <span style={{ width: 70, flexShrink: 0 }} />
              </div>
              {allCams.map((c, i) => (
                <Timeline key={i} cam={c.cam} srv={c.srv} events={c.ev} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Playback });
