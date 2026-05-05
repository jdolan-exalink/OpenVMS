// eventos.jsx — VMS Eventos page

function FilterChip({ label, value, active, removable }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', borderRadius: 7,
      border: '1px solid ' + (active ? 'var(--acc)' : 'var(--line)'),
      background: active ? 'var(--acc-soft)' : 'var(--bg-2)',
      color: active ? 'var(--acc-strong)' : 'var(--text-1)',
      fontSize: 12, fontWeight: 500,
    }}>
      <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{label}:</span>
      <span>{value}</span>
      {removable ? <span style={{ color: 'var(--text-3)', cursor: 'pointer' }}>×</span> : <span style={{ color: 'var(--text-3)' }}>▾</span>}
    </span>
  );
}

function EventModal({ onClose }) {
  return (
    <div className="mask" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span className="srvchip B"><span className="sw" />SRV-B</span>
          <h3 style={{ margin: 0, color: 'var(--text-0)', fontSize: 14, fontWeight: 600 }}>cam-04-acceso</h3>
          <span style={{
            padding: '2px 8px', borderRadius: 4, background: 'var(--warn-soft)',
            color: 'var(--warn)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--mono)',
          }}>LPR · ABC-123</span>
          <span style={{ flex: 1 }} />
          <span className="mn" style={{ color: 'var(--text-3)', fontSize: 11 }}>27/04/2026 · 14:31:48</span>
          <span onClick={onClose} style={{
            cursor: 'pointer', color: 'var(--text-2)', fontSize: 18,
            padding: '0 4px', userSelect: 'none',
          }}>×</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 0 }}>
          <div style={{ padding: 16, borderRight: '1px solid var(--line)' }}>
            <VTile name="cam-04-acceso" srv="B" live={false} ratio="16/9" dets={[
              { x: 28, y: 38, w: 26, h: 36, k: 'car', s: '0.88' },
              { x: 35, y: 56, w: 14, h: 8,  k: 'plate', s: '0.96' },
            ]} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <span className="btn primary">⏵ ver clip · 12s</span>
              <span className="btn">⤓ snapshot</span>
              <span className="btn">↗ ir a playback</span>
              <span style={{ flex: 1 }} />
              <span className="btn ghost">⋯</span>
            </div>
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>placa detectada</div>
              <div style={{
                display: 'inline-block',
                background: '#fff', color: '#000',
                fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 22,
                letterSpacing: '0.1em', padding: '6px 14px',
                border: '3px solid #000', borderRadius: 6,
              }}>ABC-123</div>
              <div className="mn" style={{ color: 'var(--text-2)', fontSize: 11, marginTop: 6 }}>
                confianza · <span style={{ color: 'var(--acc)' }}>0.96</span> · OCR primario
              </div>
            </div>

            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>metadata</div>
              <table style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 11 }}>
                <tbody>
                  {[
                    ['event_id', 'evt_8f2a1c0e'],
                    ['camera', 'cam-04-acceso'],
                    ['server', 'srv-b'],
                    ['type', 'lpr · car'],
                    ['score', '0.88 / 0.96'],
                    ['has_clip', 'true'],
                    ['has_snap', 'true'],
                    ['ended', '14:31:54'],
                    ['duration', '6.2s'],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ color: 'var(--text-3)', padding: '3px 0', width: '40%' }}>{k}</td>
                      <td style={{ color: 'var(--text-1)' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>etiquetas</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['acceso', 'autorizado', 'flota-norte'].map(tg => (
                  <span key={tg} style={{
                    padding: '3px 8px', borderRadius: 4, background: 'var(--bg-3)',
                    color: 'var(--text-1)', fontSize: 11, fontFamily: 'var(--mono)',
                  }}>#{tg}</span>
                ))}
                <span style={{
                  padding: '3px 8px', borderRadius: 4, border: '1px dashed var(--line)',
                  color: 'var(--text-3)', fontSize: 11,
                }}>+</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Eventos({ collapsed, onToggle }) {
  const [modalOpen, setModalOpen] = React.useState(false);

  const events = [
    ['14:32:06', 'A', 'cam-01-norte',   'person',  '0.92', null,        ['acceso']],
    ['14:31:48', 'B', 'cam-04-acceso',  'lpr',     '0.96', 'ABC-123',   ['acceso', 'autorizado'], true],
    ['14:30:22', 'B', 'cam-04-acceso',  'car',     '0.88', null,        ['acceso']],
    ['14:28:14', 'A', 'cam-08-techos',  'person',  '0.79', null,        []],
    ['14:26:51', 'C', 'cam-07-bodega',  'package', '0.81', null,        ['delivery']],
    ['14:24:30', 'A', 'cam-02-pasillo', 'person',  '0.74', null,        []],
    ['14:21:08', 'B', 'cam-05-patio',   'dog',     '0.66', null,        []],
    ['14:18:42', 'B', 'cam-04-acceso',  'lpr',     '0.92', 'XYZ-789',   ['acceso']],
    ['14:14:19', 'A', 'cam-09-lobby',   'person',  '0.84', null,        []],
    ['14:12:03', 'C', 'cam-07-bodega',  'forklift','0.71', null,        ['operación']],
    ['14:08:55', 'B', 'cam-10-deposito','person',  '0.69', null,        ['fuera-horario']],
    ['14:05:11', 'A', 'cam-01-norte',   'person',  '0.88', null,        []],
  ];

  return (
    <div className="vms">
      <Sidebar active="eventos" collapsed={collapsed} onToggle={onToggle} />
      <div className="main" style={{ position: 'relative' }}>
        <TopBar title="Eventos" breadcrumb="histórico · 147 hoy">
          <span className="btn ghost"><span className="dot green" />feed live</span>
          <span className="btn">exportar selección</span>
        </TopBar>

        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--line)',
          background: 'var(--bg-1)', display: 'flex', alignItems: 'center', gap: 8,
          flexWrap: 'wrap',
        }}>
          <span style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 6 }}>filtros</span>
          <FilterChip label="rango" value="hoy · 00:00–14:35" />
          <FilterChip label="servidor" value="todos" />
          <FilterChip label="cámara" value="todas" />
          <FilterChip label="tipo" value="person, car, lpr" active removable />
          <FilterChip label="placa" value="ABC*" active removable />
          <FilterChip label="score min" value="≥ 0.65" />
          <span style={{ flex: 1 }} />
          <span className="btn ghost" style={{ fontSize: 11 }}>+ filtro</span>
          <span className="btn ghost" style={{ fontSize: 11, color: 'var(--text-3)' }}>limpiar</span>
        </div>

        <div className="content" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ color: 'var(--text-2)', fontSize: 12 }}>
              <strong style={{ color: 'var(--text-0)' }}>1.247</strong> eventos · página <strong style={{ color: 'var(--text-0)' }}>1</strong> de 63
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--text-3)', fontSize: 11 }}>orden:</span>
            <span className="btn ghost" style={{ fontSize: 11 }}>más reciente ▾</span>
            <span className="btn ghost" style={{ fontSize: 11 }}>50/pág ▾</span>
          </div>

          <div className="card">
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <span style={{
                      width: 14, height: 14, display: 'inline-block',
                      border: '1px solid var(--line)', borderRadius: 3,
                      background: 'var(--bg-2)',
                    }} />
                  </th>
                  <th>Hora</th>
                  <th>Snapshot</th>
                  <th>Servidor</th>
                  <th>Cámara</th>
                  <th>Tipo</th>
                  <th>Score</th>
                  <th>Placa</th>
                  <th>Etiquetas</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr
                    key={i}
                    className={e[7] ? 'sel' : ''}
                    onClick={() => setModalOpen(true)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <span style={{
                        width: 14, height: 14, display: 'inline-block',
                        border: '1px solid ' + (e[7] ? 'var(--acc)' : 'var(--line)'),
                        background: e[7] ? 'var(--acc)' : 'var(--bg-2)',
                        borderRadius: 3, position: 'relative',
                      }}>
                        {e[7] ? <span style={{
                          position: 'absolute', inset: 0, color: '#0d0f14',
                          fontSize: 10, lineHeight: 1, display: 'flex',
                          alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                        }}>✓</span> : null}
                      </span>
                    </td>
                    <td className="mn" style={{ color: 'var(--text-2)' }}>{e[0]}</td>
                    <td>
                      <div className="vtile tn" style={{ height: 40, width: 64 }}>
                        <div className="ovl" />
                      </div>
                    </td>
                    <td><span className={'srvchip ' + e[1]}><span className="sw" />SRV-{e[1]}</span></td>
                    <td className="mn">{e[2]}</td>
                    <td>
                      <span style={{
                        display: 'inline-flex', padding: '2px 8px', borderRadius: 4,
                        background: e[3] === 'lpr' ? 'var(--warn-soft)' : 'var(--bg-3)',
                        color: e[3] === 'lpr' ? 'var(--warn)' : 'var(--text-1)',
                        fontSize: 11, fontWeight: 500,
                      }}>{e[3]}</span>
                    </td>
                    <td className="mn">
                      <span style={{ color: parseFloat(e[4]) >= 0.85 ? 'var(--acc)' : 'var(--text-1)' }}>{e[4]}</span>
                    </td>
                    <td className="mn">
                      {e[5] ? (
                        <span style={{
                          color: '#000', background: '#fff',
                          fontWeight: 700, letterSpacing: '0.05em',
                          padding: '2px 6px', borderRadius: 3,
                          border: '1.5px solid #000', display: 'inline-block',
                        }}>{e[5]}</span>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {e[6].map(tg => (
                          <span key={tg} style={{
                            padding: '1px 6px', borderRadius: 3, fontFamily: 'var(--mono)',
                            fontSize: 10, background: 'var(--bg-3)', color: 'var(--text-2)',
                          }}>#{tg}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="btn ghost" style={{ fontSize: 11, padding: '3px 8px' }}>ver</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, justifyContent: 'center' }}>
            <span className="btn ghost" style={{ fontSize: 11 }}>‹ anterior</span>
            {[1,2,3,4,5].map(p => (
              <span key={p} style={{
                width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 6, fontSize: 12, fontFamily: 'var(--mono)',
                background: p === 1 ? 'var(--acc)' : 'transparent',
                color: p === 1 ? '#0d0f14' : 'var(--text-2)',
                fontWeight: p === 1 ? 600 : 400, cursor: 'pointer',
                border: '1px solid ' + (p === 1 ? 'var(--acc)' : 'transparent'),
              }}>{p}</span>
            ))}
            <span style={{ color: 'var(--text-3)', padding: '0 4px' }}>…</span>
            <span style={{
              width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-2)',
            }}>63</span>
            <span className="btn ghost" style={{ fontSize: 11 }}>siguiente ›</span>
          </div>
        </div>

        {modalOpen ? <EventModal onClose={() => setModalOpen(false)} /> : null}
      </div>
    </div>
  );
}

Object.assign(window, { Eventos });
