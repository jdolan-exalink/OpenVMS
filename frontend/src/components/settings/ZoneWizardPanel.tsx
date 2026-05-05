import { useState } from "react";
import { useQuery } from "react-query";
import { listCameras } from "../../api/cameras";
import ZoneWizard, { ZoneConfig } from "../enterprise/ZoneWizard";

export default function ZoneWizardPanel({ isAdmin }: { isAdmin: boolean }) {
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [zones, setZones] = useState<Record<string, ZoneConfig[]>>({});

  const camerasQuery = useQuery("zone-wizard-cameras", () => listCameras({ page_size: 200 }));
  const cameras = camerasQuery.data?.items ?? [];

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId);

  function handleZonesChange(cameraId: string, newZones: ZoneConfig[]) {
    setZones((prev) => ({ ...prev, [cameraId]: newZones }));
  }

  function handleSaveZones() {
    console.log("Saving zones:", zones);
    localStorage.setItem("openvms.zones.v1", JSON.stringify(zones));
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "300px 1fr" }}>
      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>Seleccionar Cámara</h3>
        </div>
        <div className="p-2">
          {camerasQuery.isLoading ? (
            <div className="p-4 text-sm text-[var(--text-2)]">Cargando...</div>
          ) : cameras.length === 0 ? (
            <div className="p-4 text-sm text-[var(--text-2)]">No hay cámaras</div>
          ) : (
            <div className="space-y-1">
              {cameras.map((camera) => (
                <button
                  key={camera.id}
                  onClick={() => setSelectedCameraId(camera.id)}
                  className={`w-full truncate rounded px-3 py-2 text-left text-xs transition ${
                    selectedCameraId === camera.id
                      ? "bg-[var(--acc)] text-white"
                      : "hover:bg-[var(--bg-3)] text-[var(--text-1)]"
                  }`}
                >
                  {camera.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedCameraId && zones[selectedCameraId] && zones[selectedCameraId].length > 0 && (
          <div className="border-t border-[var(--line)] p-3">
            <div className="mb-2 text-xs font-semibold text-[var(--text-1)]">
              Zonas configuradas: {zones[selectedCameraId].length}
            </div>
            <div className="mb-3 space-y-1">
              {zones[selectedCameraId].map((zone, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded bg-[var(--bg-3)] px-2 py-1 text-[10px]"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: zone.color }}
                  />
                  <span className="flex-1 truncate text-[var(--text-1)]">{zone.name}</span>
                  <span className="text-[var(--text-3)]">{zone.points.length} pts</span>
                </div>
              ))}
            </div>
            {isAdmin && (
              <button onClick={handleSaveZones} className="vms-btn primary w-full">
                Guardar Zonas
              </button>
            )}
          </div>
        )}
      </div>

      <div className="vms-card">
        <div className="vms-card-hd">
          <h3>
            {selectedCamera ? `Zonas: ${selectedCamera.display_name}` : "Selecciona una cámara"}
          </h3>
        </div>
        <div className="p-4">
          {selectedCamera ? (
            <ZoneWizard
              imageWidth={640}
              imageHeight={480}
              existingZones={zones[selectedCameraId!] ?? []}
              onZonesChange={(newZones) => handleZonesChange(selectedCameraId!, newZones)}
            />
          ) : (
            <div className="flex h-96 flex-col items-center justify-center gap-2 text-sm text-[var(--text-2)]">
              <span className="text-3xl opacity-30">📷</span>
              <span>Selecciona una cámara para configurar zonas</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}