// app.jsx — wires hi-fi pages into a DesignCanvas

function PageWrap({ Page }) {
  const [collapsed, setCollapsed] = React.useState(false);
  return <Page collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />;
}

function Root() {
  const W = 1440, H = 900;
  return (
    <DesignCanvas>
      <DCSection id="hifi" title="OpenVMS · Hi-Fi" subtitle="Tema oscuro · #00d084 · Inter + JetBrains Mono · doble-click en cualquier tarjeta para ver en pantalla completa">
        <DCArtboard id="liveview" label="LiveView · cam fullscreen + PTZ + drawer eventos" width={W} height={H}>
          <PageWrap Page={LiveView} />
        </DCArtboard>
        <DCArtboard id="dashboard" label="Dashboard · resumen" width={W} height={H}>
          <PageWrap Page={Dashboard} />
        </DCArtboard>
        <DCArtboard id="eventos" label="Eventos · tabla + filtros + modal" width={W} height={H}>
          <PageWrap Page={Eventos} />
        </DCArtboard>
        <DCArtboard id="playback" label="Playback · multi-cam sync + timeline" width={W} height={H}>
          <PageWrap Page={Playback} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
