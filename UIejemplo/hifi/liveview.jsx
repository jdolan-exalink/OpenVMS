// liveview.jsx — VMS LiveView hi-fi page

// ─── Layout definitions ──────────────────────────────────────────────────
// Each layout returns an array of cell rects { x, y, w, h } in 0..1 normalized space.
const LAYOUTS = {
  '1':    { label: '1×1',  cells: [{ x: 0, y: 0, w: 1, h: 1 }] },
  '2x2':  { label: '2×2',  cells: gridCells(2, 2) },
  '3x3':  { label: '3×3',  cells: gridCells(3, 3) },
  '4x4':  { label: '4×4',  cells: gridCells(4, 4) },
  '5x5':  { label: '5×5',  cells: gridCells(5, 5) },
  '1+5':  { label: '1+5',  cells: focusCells(5) },   // 1 hero + 5 thumbs
  '1+11': { label: '1+11', cells: focusCells(11) },  // 1 hero + 11 thumbs
};

function gridCells(cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: c / cols, y: r / rows, w: 1 / cols, h: 1 / rows });
    }
  }
  return out;
}

// 1 large + N small thumbs around it.
// 1+5: hero takes top-left 3/4×3/4. 5 thumbs: 1 right column (3 stacked) + bottom row (2).
// 1+11: hero takes top-left 3/4×3/4. 11 thumbs: right col (3) + bottom row (4) + extras: re-tile to 4×4 minus 4 covered cells.
function focusCells(n) {
  if (n === 5) {
    // 4 cols × 4 rows; hero occupies cols 0..2, rows 0..2 (3×3). Thumbs fill the right col + bottom row.
    const cells = [{ x: 0, y: 0, w: 3 / 4, h: 3 / 4 }];
    for (let r = 0; r < 3; r++) cells.push({ x: 3 / 4, y: r / 4, w: 1 / 4, h: 1 / 4 });   // right col 3
    for (let c = 0; c < 2; c++) cells.push({ x: c / 4, y: 3 / 4, w: 1 / 4, h: 1 / 4 });   // bottom-left 2
    return cells; // 1+3+2 = 6? want 1+5 → adjust to 1 hero + 5 thumbs
  }
  if (n === 11) {
    // 4×4 grid: hero occupies top-left 3×3 (covers 9 cells). Remaining 16-9 = 7 cells. Need 11 → use 5×5.
    // 5×5: hero top-left 4×4 (16 cells). Remaining 25-16 = 9 → use 5×5 with hero 3×3 (9 cells), remaining 16. Pick 11 of 16.
    // Simpler: hero takes top-left of a 4×4 layout (3×3 region = 3/4×3/4). That leaves a right column of 3 and bottom row of 4 = 7. Not enough.
    // Use 4×4 grid; hero occupies top-left 2×2 (4 cells). Remaining 12 cells → take 11.
    const cells = [{ x: 0, y: 0, w: 2 / 4, h: 2 / 4 }];
    // right cols (cols 2,3) rows 0..1 = 4 cells
    for (let c = 2; c < 4; c++) for (let r = 0; r < 2; r++) cells.push({ x: c / 4, y: r / 4, w: 1 / 4, h: 1 / 4 });
    // bottom 2 rows (rows 2,3) cols 0..3 = 8 cells; take first 7
    for (let r = 2; r < 4; r++) for (let c = 0; c < 4; c++) {
      if (cells.length < 12) cells.push({ x: c / 4, y: r / 4, w: 1 / 4, h: 1 / 4 });
    }
    return cells; // 1 hero + 11 = 12
  }
  return [];
}

// fix 1+5: redo cleanly
LAYOUTS['1+5'] = {
  label: '1+5',
  cells: (() => {
    // 3-col grid; hero occupies cols 0..1 rows 0..1 (2×2). Right col (col 2) has 3 cells. Bottom row (row 2) cols 0..1 has 2 cells. 1+3+2=6.
    const cells = [{ x: 0, y: 0, w: 2 / 3, h: 2 / 3 }];
    for (let r = 0; r < 3; r++) cells.push({ x: 2 / 3, y: r / 3, w: 1 / 3, h: 1 / 3 });  // right column
    for (let c = 0; c < 2; c++) cells.push({ x: c / 3, y: 2 / 3, w: 1 / 3, h: 1 / 3 });  // bottom-left
    return cells;
  })(),
};

// ─── Camera roster ───────────────────────────────────────────────────────
const CAM_ROSTER = [
  { srv: 'A', cam: 'cam-01-norte',     audio: true,  dets: [{ x: 22, y: 32, w: 18, h: 50, k: 'person', s: '0.92' }, { x: 60, y: 50, w: 22, h: 30, k: 'car', s: '0.81' }] },
  { srv: 'B', cam: 'cam-04-acceso',    audio: false, dets: [{ x: 30, y: 38, w: 26, h: 36, k: 'car', s: '0.88' }] },
  { srv: 'B', cam: 'cam-05-patio',     audio: false, dets: [] },
  { srv: 'A', cam: 'cam-08-techos',    audio: false, dets: [{ x: 50, y: 28, w: 18, h: 42, k: 'person', s: '0.78' }] },
  { srv: 'C', cam: 'cam-07-bodega',    audio: true,  dets: [] },
  { srv: 'A', cam: 'cam-02-pasillo',   audio: false, dets: [{ x: 35, y: 30, w: 20, h: 50, k: 'person', s: '0.74' }] },
  { srv: 'B', cam: 'cam-06-estacion',  audio: false, dets: [{ x: 25, y: 45, w: 30, h: 32, k: 'car', s: '0.69' }] },
  { srv: 'D', cam: 'cam-09-sala',      audio: false, dets: [] },
  { srv: 'C', cam: 'cam-10-deposito',  audio: false, dets: [] },
  { srv: 'A', cam: 'cam-03-sur',       audio: false, dets: [] },
  { srv: 'D', cam: 'cam-11-of',        audio: false, dets: [{ x: 40, y: 30, w: 18, h: 50, k: 'person', s: '0.71' }] },
  { srv: 'B', cam: 'cam-12-rampa',     audio: false, dets: [] },
  { srv: 'C', cam: 'cam-13-perim',     audio: false, dets: [{ x: 30, y: 40, w: 30, h: 35, k: 'car', s: '0.65' }] },
  { srv: 'A', cam: 'cam-14-recep',     audio: true,  dets: [] },
  { srv: 'D', cam: 'cam-15-pasaje',    audio: false, dets: [] },
  { srv: 'A', cam: 'cam-16-techo-2',   audio: false, dets: [] },
  { srv: 'B', cam: 'cam-17-puerta',    audio: false, dets: [{ x: 40, y: 30, w: 22, h: 50, k: 'person', s: '0.83' }] },
  { srv: 'C', cam: 'cam-18-tunel',     audio: false, dets: [] },
  { srv: 'A', cam: 'cam-19-azotea',    audio: false, dets: [] },
  { srv: 'D', cam: 'cam-20-jardin',    audio: false, dets: [] },
  { srv: 'B', cam: 'cam-21-frente',    audio: false, dets: [] },
  { srv: 'C', cam: 'cam-22-fondo',     audio: false, dets: [] },
  { srv: 'A', cam: 'cam-23-of-2',      audio: false, dets: [] },
  { srv: 'D', cam: 'cam-24-pasillo-2', audio: false, dets: [] },
  { srv: 'B', cam: 'cam-25-cocina',    audio: false, dets: [] },
];

// ─── Layout switcher (segmented control) ─────────────────────────────────
function LayoutSwitch({ value, onChange }) {
  const opts = Object.keys(LAYOUTS);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 0,
      border: '1px solid var(--line)', borderRadius: 7, overflow: 'hidden',
      background: 'var(--bg-2)',
    }}>
      {opts.map((k, i) => {
        const active = k === value;
        return (
          <span
            key={k}
            onClick={() => onChange(k)}
            style={{
              padding: '5px 10px', fontSize: 11, fontFamily: 'var(--mono)',
              background: active ? 'var(--acc)' : 'transparent',
              color: active ? '#0d0f14' : 'var(--text-2)',
              fontWeight: active ? 700 : 500,
              borderRight: i < opts.length - 1 ? '1px solid var(--line)' : 'none',
              cursor: 'pointer', userSelect: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <LayoutIcon kind={k} active={active} />
            {LAYOUTS[k].label}
          </span>
        );
      })}
    </div>
  );
}

// Tiny SVG glyphs for each layout option
function LayoutIcon({ kind, active }) {
  const stroke = active ? '#0d0f14' : 'var(--text-2)';
  const fill = active ? 'rgba(13,15,20,.18)' : 'transparent';
  const sw = 1.2;
  const cells = LAYOUTS[kind].cells;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      {cells.map((c, i) => (
        <rect
          key={i}
          x={1 + c.x * 12} y={1 + c.y * 12}
          width={Math.max(1, c.w * 12 - 0.6)} height={Math.max(1, c.h * 12 - 0.6)}
          fill={i === 0 && (kind === '1+5' || kind === '1+11') ? (active ? '#0d0f14' : 'var(--text-1)') : fill}
          stroke={stroke} strokeWidth={sw}
        />
      ))}
    </svg>
  );
}

// ─── Tile (compact for grid usage) ───────────────────────────────────────
function GridTile({ cam, focused, hero, density, onClick }) {
  // density: 'normal' | 'dense' (smaller chrome)
  const dense = density === 'dense';
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative', height: '100%', width: '100%',
        background: '#000', borderRadius: 6, overflow: 'hidden',
        border: focused ? '2px solid var(--acc)' : '1px solid var(--line)',
        boxShadow: focused ? '0 0 0 2px var(--acc-soft), 0 8px 24px rgba(0,208,132,.18)' : 'none',
        cursor: 'pointer',
        backgroundImage:
          'radial-gradient(ellipse at 30% 40%, rgba(0,208,132,.06), transparent 60%),' +
          'linear-gradient(135deg, transparent 49%, rgba(255,255,255,.04) 49%, rgba(255,255,255,.04) 51%, transparent 51%),' +
          'linear-gradient(180deg, #0a0d12 0%, #1a1f2e 100%)',
      }}
    >
      {/* detection boxes — only when not super dense */}
      {!dense && cam.dets && cam.dets.map((d, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: d.x + '%', top: d.y + '%',
          width: d.w + '%', height: d.h + '%',
          border: '1.5px solid var(--acc)',
          borderRadius: 3,
          boxShadow: '0 0 0 1px rgba(0,0,0,.5)',
        }}>
          {hero ? (
            <span style={{
              position: 'absolute', top: -18, left: 0,
              background: 'var(--acc)', color: '#0d0f14',
              fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
              padding: '1px 5px', borderRadius: 2, whiteSpace: 'nowrap',
            }}>{d.k} {d.s}</span>
          ) : null}
        </div>
      ))}

      {/* top chrome */}
      <div style={{
        position: 'absolute', top: dense ? 4 : 6, left: dense ? 4 : 6, right: dense ? 4 : 6,
        display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'none',
      }}>
        <span className={'srvchip ' + cam.srv} style={{
          fontSize: dense ? 9 : 10, padding: dense ? '1px 5px' : '2px 7px',
        }}><span className="sw" />{cam.srv}</span>
        <span style={{
          fontFamily: 'var(--mono)',
          fontSize: dense ? 9 : 10,
          color: '#fff',
          background: 'rgba(0,0,0,.6)',
          padding: dense ? '1px 5px' : '1px 6px',
          borderRadius: 3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: '70%',
        }}>{cam.cam}</span>
        <span style={{ flex: 1 }} />
        <span style={{
          fontFamily: 'var(--mono)', fontSize: dense ? 8 : 9,
          background: 'var(--acc)', color: '#0d0f14',
          padding: dense ? '0 4px' : '1px 6px',
          borderRadius: 3, fontWeight: 700,
        }}>● LIVE</span>
      </div>

      {/* bottom: only show on hero or non-dense */}
      {hero && (
        <div style={{
          position: 'absolute', bottom: 6, left: 6,
          fontFamily: 'var(--mono)', fontSize: 10, color: '#fff',
          background: 'rgba(0,0,0,.6)', padding: '1px 6px', borderRadius: 3,
        }}>14:32:06 · 1080p · 30fps</div>
      )}
    </div>
  );
}

// ─── Camera grid ─────────────────────────────────────────────────────────
function CamGrid({ layoutKey, focusedIdx, onFocus }) {
  const layout = LAYOUTS[layoutKey];
  const cells = layout.cells;
  const hasHero = layoutKey === '1+5' || layoutKey === '1+11' || layoutKey === '1';
  const dense = cells.length > 9;

  return (
    <div style={{
      position: 'absolute', inset: 0,
      padding: 4,
    }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
      }}>
        {cells.map((c, i) => {
          const cam = CAM_ROSTER[i % CAM_ROSTER.length];
          const isHero = hasHero && i === 0;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `calc(${c.x * 100}% + 2px)`,
                top: `calc(${c.y * 100}% + 2px)`,
                width: `calc(${c.w * 100}% - 4px)`,
                height: `calc(${c.h * 100}% - 4px)`,
              }}
            >
              <GridTile
                cam={cam}
                hero={isHero}
                focused={i === focusedIdx}
                density={dense && !isHero ? 'dense' : 'normal'}
                onClick={() => onFocus(i)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Event drawer ────────────────────────────────────────────────────────
function EventDrawer({ open, onClose }) {
  const events = [
    ['14:32:06', 'A', 'cam-01-norte',  'person',  '0.92', null,      true],
    ['14:31:48', 'B', 'cam-04-acceso', 'lpr',     '0.96', 'ABC-123', true],
    ['14:30:22', 'B', 'cam-04-acceso', 'car',     '0.88', null,      false],
    ['14:28:14', 'A', 'cam-08-techos', 'person',  '0.79', null,      false],
    ['14:26:51', 'C', 'cam-07-bodega', 'package', '0.81', null,      false],
    ['14:24:30', 'A', 'cam-02-pasillo','person',  '0.74', null,      false],
    ['14:21:08', 'B', 'cam-05-patio',  'dog',     '0.66', null,      false],
    ['14:18:42', 'B', 'cam-04-acceso', 'lpr',     '0.92', 'XYZ-789', false],
  ];
  return (
    <div style={{
      width: open ? 320 : 0,
      borderLeft: open ? '1px solid var(--line)' : 'none',
      background: 'var(--bg-1)',
      transition: 'width .22s ease',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      flexShrink: 0,
    }}>
      <div style={{ width: 320, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '12px 14px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <h3 style={{ margin: 0, color: 'var(--text-0)', fontSize: 13, fontWeight: 600 }}>Eventos en vivo</h3>
          <span className="pill green"><span className="dot green" />WS</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)' }}>14 nuevos</span>
          <span onClick={onClose} style={{
            cursor: 'pointer', color: 'var(--text-2)', fontSize: 16,
            padding: '0 4px', userSelect: 'none', lineHeight: 1,
          }}>×</span>
        </div>

        <div style={{
          padding: '8px 14px', borderBottom: '1px solid var(--line-2)',
          display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>filtros</span>
          {['todos', 'person', 'car', 'lpr'].map((f, i) => (
            <span key={f} style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 11,
              background: i === 0 ? 'var(--acc-soft)' : 'var(--bg-2)',
              color: i === 0 ? 'var(--acc-strong)' : 'var(--text-2)',
              fontWeight: 500, cursor: 'pointer',
            }}>{f}</span>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {events.map((e, i) => (
            <div key={i} style={{
              display: 'flex', gap: 10, padding: 8, borderRadius: 7,
              background: e[6] ? 'var(--bg-2)' : 'transparent',
              border: '1px solid ' + (e[6] ? 'var(--line)' : 'transparent'),
              cursor: 'pointer',
            }}>
              <div className="vtile tn" style={{ width: 60, height: 44, flexShrink: 0 }}>
                <div className="ovl" />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span className={'srvchip ' + e[1]}><span className="sw" />{e[1]}</span>
                  <span className="mn" style={{ fontSize: 10, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e[2]}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 500,
                    background: e[3] === 'lpr' ? 'var(--warn-soft)' : 'var(--bg-3)',
                    color: e[3] === 'lpr' ? 'var(--warn)' : 'var(--text-1)',
                  }}>{e[3]}</span>
                  {e[5] ? (
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
                      background: '#fff', color: '#000', padding: '1px 5px',
                      borderRadius: 2, border: '1.2px solid #000', letterSpacing: '0.05em',
                    }}>{e[5]}</span>
                  ) : (
                    <span className="mn" style={{ fontSize: 10, color: parseFloat(e[4]) >= 0.85 ? 'var(--acc)' : 'var(--text-2)' }}>{e[4]}</span>
                  )}
                </div>
                <span className="mn" style={{ fontSize: 10, color: 'var(--text-3)' }}>{e[0]}</span>
              </div>
              {e[6] ? <span className="dot green" style={{ marginTop: 4 }} /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── PTZ widget (only shown for 1×1 / hero of focus layouts) ─────────────
function PTZWidget() {
  return (
    <div style={{
      position: 'absolute', right: 12, top: 12,
      width: 132, padding: 10,
      background: 'rgba(13,15,20,.88)',
      border: '1px solid var(--line)', borderRadius: 10,
      backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
      zIndex: 5,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', fontSize: 11, color: 'var(--text-1)', fontWeight: 600,
      }}>
        <span>PTZ</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)' }}>×4.2</span>
      </div>
      <div style={{
        width: 88, height: 88, borderRadius: '50%',
        border: '1px dashed var(--acc)', position: 'relative',
        background: 'radial-gradient(circle, transparent 30%, rgba(0,208,132,.06) 70%)',
      }}>
        {[
          ['↑', { top: -8, left: 33 }],
          ['↓', { bottom: -8, left: 33 }],
          ['←', { top: 33, left: -8 }],
          ['→', { top: 33, right: -8 }],
        ].map(([a, pos]) => (
          <div key={a} style={{
            position: 'absolute', ...pos,
            width: 22, height: 22, borderRadius: '50%',
            background: 'var(--bg-2)', border: '1px solid var(--acc)',
            color: 'var(--acc-strong)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
          }}>{a}</div>
        ))}
        <div style={{
          position: 'absolute', inset: 30, borderRadius: '50%',
          background: 'var(--acc-soft)', border: '1px solid var(--acc)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--acc-strong)',
        }}>HOME</div>
      </div>
      <div style={{ display: 'flex', gap: 3, width: '100%' }}>
        {['−', 'zoom', '+'].map((s, i) => (
          <span key={i} style={{
            flex: 1, padding: '3px 0', textAlign: 'center', borderRadius: 5,
            background: 'var(--bg-2)', border: '1px solid var(--line)',
            fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-1)', cursor: 'pointer',
          }}>{s}</span>
        ))}
      </div>
      <div style={{
        display: 'flex', gap: 3, width: '100%',
        paddingTop: 5, borderTop: '1px solid var(--line)',
      }}>
        <span style={{ fontSize: 9, color: 'var(--text-3)', marginRight: 'auto', alignSelf: 'center' }}>presets</span>
        {[1,2,3,4].map(n => (
          <span key={n} style={{
            width: 16, height: 16, borderRadius: 3, fontSize: 9,
            background: n === 1 ? 'var(--acc)' : 'var(--bg-2)',
            color: n === 1 ? '#0d0f14' : 'var(--text-1)',
            border: '1px solid ' + (n === 1 ? 'var(--acc)' : 'var(--line)'),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--mono)', fontWeight: 600, cursor: 'pointer',
          }}>{n}</span>
        ))}
      </div>
    </div>
  );
}

// ─── LiveView main ───────────────────────────────────────────────────────
function LiveView({ collapsed, onToggle }) {
  const [eventsOpen, setEventsOpen] = React.useState(true);
  const [layoutKey, setLayoutKey] = React.useState('2x2');
  const [focusedIdx, setFocusedIdx] = React.useState(0);

  const layout = LAYOUTS[layoutKey];
  const focusedCam = CAM_ROSTER[focusedIdx % CAM_ROSTER.length];
  const isSingle = layoutKey === '1';
  const showPTZ = isSingle; // PTZ overlay only on single-camera view
  const totalCells = layout.cells.length;

  return (
    <div className="vms">
      <Sidebar active="live" collapsed={collapsed} onToggle={onToggle} />
      <div className="main">
        <TopBar title="LiveView" breadcrumb={`${totalCells} cámara${totalCells > 1 ? 's' : ''} · ${layout.label}`}>
          <span className="btn ghost">⏵ playback</span>
          <span className="btn ghost">⤓ snapshot</span>
          <span className="btn ghost">♪ audio</span>
          <span
            className={'btn ' + (eventsOpen ? 'primary' : '')}
            onClick={() => setEventsOpen(v => !v)}
            style={{ cursor: 'pointer' }}
          >
            ◈ eventos
            <span style={{
              marginLeft: 4, padding: '0 6px', borderRadius: 8,
              background: eventsOpen ? '#0d0f14' : 'var(--acc)',
              color: eventsOpen ? 'var(--acc-strong)' : '#0d0f14',
              fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
            }}>14</span>
            <span style={{ marginLeft: 4, fontFamily: 'var(--mono)', fontSize: 10 }}>{eventsOpen ? '▸' : '◂'}</span>
          </span>
        </TopBar>

        {/* Layout switcher + focused-camera info */}
        <div style={{
          padding: '10px 20px', borderBottom: '1px solid var(--line)',
          background: 'var(--bg-1)', display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <span style={{
            color: 'var(--text-3)', fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '.06em',
          }}>vista</span>
          <LayoutSwitch value={layoutKey} onChange={setLayoutKey} />

          <div style={{ width: 1, height: 22, background: 'var(--line)' }} />

          <span style={{
            color: 'var(--text-3)', fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '.06em',
          }}>foco</span>
          <span className={'srvchip ' + focusedCam.srv} style={{ padding: '3px 9px', fontSize: 11 }}>
            <span className="sw" />SRV-{focusedCam.srv}
          </span>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-0)', fontWeight: 600,
          }}>{focusedCam.cam}</span>
          <span className="pill green"><span className="dot green" />LIVE · 1080p</span>

          <span style={{ flex: 1 }} />

          <span className="mn" style={{ color: 'var(--text-2)', fontSize: 11 }}>
            <span style={{ color: 'var(--text-3)' }}>fps</span> 30 ·
            <span style={{ color: 'var(--text-3)' }}> bitrate</span> 4.2Mb/s ·
            <span style={{ color: 'var(--text-3)' }}> latencia</span> <span style={{ color: 'var(--acc)' }}>180ms</span>
          </span>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Main video grid */}
          <div style={{
            flex: 1, padding: 12, position: 'relative', minWidth: 0,
            background: 'var(--bg-0)', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <CamGrid
                layoutKey={layoutKey}
                focusedIdx={focusedIdx}
                onFocus={setFocusedIdx}
              />
              {showPTZ && <PTZWidget />}
            </div>

            {/* Bottom bar: timecode + scrubber for focused camera */}
            <div style={{
              marginTop: 10,
              background: 'var(--bg-1)', border: '1px solid var(--line)',
              borderRadius: 10, padding: '8px 14px',
              display: 'flex', alignItems: 'center', gap: 12,
              flexShrink: 0,
            }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 9px', borderRadius: 4, background: 'var(--acc)',
                color: '#0d0f14', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700,
              }}>● LIVE</span>
              <span className="mn" style={{ color: 'var(--text-1)', fontSize: 12, fontWeight: 500 }}>14:32:06</span>
              <div style={{
                flex: 1, height: 8, position: 'relative', cursor: 'pointer',
                background: 'var(--bg-3)', borderRadius: 4,
              }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, height: '100%',
                  width: '100%', background: 'linear-gradient(90deg, rgba(0,208,132,0.15) 0%, var(--acc-soft) 100%)',
                  borderRadius: 4,
                }} />
                {[8, 22, 38, 54, 71, 88].map((p, i) => (
                  <div key={p} style={{
                    position: 'absolute', left: `${p}%`, top: -2, bottom: -2,
                    width: 2,
                    background: i === 1 ? 'var(--warn)' : 'var(--acc-strong)',
                    boxShadow: '0 0 4px rgba(255,255,255,.4)',
                  }} />
                ))}
                <div style={{
                  position: 'absolute', right: 0, top: -3, bottom: -3, width: 3,
                  background: '#fff', borderRadius: 2,
                  boxShadow: '0 0 10px rgba(255,255,255,.8)',
                }} />
              </div>
              <span className="mn" style={{ color: 'var(--text-3)', fontSize: 11 }}>−5m</span>
              <span style={{
                padding: '4px 10px', borderRadius: 5, background: 'var(--bg-2)',
                border: '1px solid var(--line)', color: 'var(--text-1)',
                fontSize: 11, fontWeight: 500, cursor: 'pointer',
              }}>↶ retroceder</span>
            </div>
          </div>

          <EventDrawer open={eventsOpen} onClose={() => setEventsOpen(false)} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LiveView });
