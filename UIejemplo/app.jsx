// app.jsx — wires the variants into a DesignCanvas

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "rough": false,
  "density": "regular",
  "annotations": true,
  "accent": "#2a8f5f"
}/*EDITMODE-END*/;

function Root() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply global classes via root effect
  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('rough', !!t.rough);
    root.classList.remove('density-compact', 'density-comfy');
    if (t.density === 'compact') root.classList.add('density-compact');
    if (t.density === 'comfy')   root.classList.add('density-comfy');
    root.classList.toggle('no-annotations', !t.annotations);
    root.style.setProperty('--accent', t.accent);
    // Derive softer accent fill from the chosen accent
    root.style.setProperty('--accent-fill',
      t.accent === '#2a8f5f' ? '#d6ecdf'
      : t.accent === '#3b6ec9' ? '#d4e0f3'
      : t.accent === '#c96442' ? '#f1d6cb'
      : '#e3d7ee');
    root.style.setProperty('--accent-soft',
      t.accent === '#2a8f5f' ? '#a7d8c2'
      : t.accent === '#3b6ec9' ? '#a8bee0'
      : t.accent === '#c96442' ? '#e8b9aa'
      : '#c8b3dd');
  }, [t.rough, t.density, t.annotations, t.accent]);

  // Artboard dimensions
  const W = 1280, H = 800;
  const TW = 1024, TH = 700;     // tablet artboard
  const COVER_W = 720, COVER_H = 600;

  return (
    <>
      <DesignCanvas>
        <DCSection id="desktop" title="LiveView · Fullscreen focus" subtitle="Sidebar compactable · panel de eventos desplegable desde el botón ◈ eventos">
          <DCArtboard id="E" label="Desktop · panel de eventos cerrado" width={W} height={H}>
            <VariantE showAnnotations={t.annotations} />
          </DCArtboard>
        </DCSection>

        <DCSection id="cover" title="Notas" subtitle="Vocabulario y leyenda">
          <DCArtboard id="cover" label="Leyenda" width={COVER_W} height={COVER_H}>
            <CoverBoard />
          </DCArtboard>
        </DCSection>

        <DCSection id="tablet" title="Tablet · 1024×700" subtitle="LiveView en horizontal · controles touch">
          <DCArtboard id="tablet-1" label="Tablet · 2×2 + tray táctil" width={TW} height={TH}>
            <VariantTablet showAnnotations={t.annotations} />
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Estilo del wireframe" />
        <TweakToggle
          label="Roughness (filtro wobble)"
          value={t.rough}
          onChange={(v) => setTweak('rough', v)}
        />
        <TweakRadio
          label="Densidad"
          value={t.density}
          options={['compact', 'regular', 'comfy']}
          onChange={(v) => setTweak('density', v)}
        />
        <TweakToggle
          label="Mostrar notas / anotaciones"
          value={t.annotations}
          onChange={(v) => setTweak('annotations', v)}
        />
        <TweakSection label="Acento" />
        <TweakColor
          label="Acento"
          value={t.accent}
          onChange={(v) => setTweak('accent', v)}
        />
        <TweakRadio
          label="Presets"
          value={t.accent}
          options={['#2a8f5f', '#3b6ec9', '#c96442', '#8a5cb5']}
          onChange={(v) => setTweak('accent', v)}
        />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
