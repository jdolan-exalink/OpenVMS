import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "react-query";
import {
  FaceAppearance,
  RegisteredFace,
  UnknownFace,
  deleteFace,
  getFaceImageUrl,
  identifyFace,
  listFaceAppearances,
  listFaces,
  listUnknownFaces,
  registerFace,
  renameFace,
} from "../../api/plugins";

function fmt(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
}

function detectionTime(iso: string | null) {
  return fmt(iso) || "Sin fecha";
}

function cleanCamera(name: string | null | undefined) {
  if (!name) return "Sin camara";
  return name.replaceAll("_", " ");
}

export default function FaceRecognitionPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RegisteredFace | null>(null);
  const [namingFace, setNamingFace] = useState<UnknownFace | null>(null);
  const [previewFace, setPreviewFace] = useState<UnknownFace | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const knownQ = useQuery(["faces-known", search], () => listFaces(search || undefined, 100));
  const unknownQ = useQuery(["faces-unknown"], () => listUnknownFaces(80), { refetchInterval: 30000 });
  const appearancesQ = useQuery(
    ["face-appearances", selected?.person_name],
    () => listFaceAppearances(selected!.person_name),
    { enabled: Boolean(selected?.person_name) },
  );

  const known = knownQ.data ?? [];
  const unknown = unknownQ.data ?? [];
  const selectedFace = selected && known.some((f) => f.id === selected.id) ? selected : known[0] ?? null;

  useEffect(() => {
    if (!selected && known.length > 0) setSelected(known[0]);
    if (selected && !known.some((f) => f.id === selected.id)) setSelected(known[0] ?? null);
  }, [known, selected]);

  const refresh = () => {
    knownQ.refetch();
    unknownQ.refetch();
    appearancesQ.refetch();
  };

  const identifyMut = useMutation(
    () => identifyFace(namingFace!.id, nameDraft.trim()),
    {
      onSuccess: () => {
        setNamingFace(null);
        setNameDraft("");
        refresh();
      },
    },
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto bg-[var(--bg-0)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-lg font-semibold text-[var(--text-0)]">Rostros</h1>
          <p className="text-xs text-[var(--text-3)]">Busca una cara, asigna nombres y reconstruye su recorrido.</p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nombre en todas las camaras"
          className="h-9 w-full max-w-sm rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 flex-col gap-4">
          <section className="min-h-0">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="m-0 text-sm font-semibold text-[var(--text-0)]">Registrados</h2>
              <span className="rounded bg-[var(--bg-2)] px-2 py-0.5 text-xs text-[var(--text-2)]">{known.length}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {known.map((face) => (
                <KnownFaceCard
                  key={face.id}
                  face={face}
                  active={selectedFace?.id === face.id}
                  onClick={() => setSelected(face)}
                  onChanged={refresh}
                />
              ))}
              {known.length === 0 && !knownQ.isLoading && (
                <EmptyState text={search ? "No hay coincidencias con ese nombre" : "No hay rostros registrados"} />
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="m-0 text-sm font-semibold text-[var(--text-0)]">Desconocidos</h2>
              <span className="rounded bg-[var(--bg-2)] px-2 py-0.5 text-xs text-[var(--text-2)]">{unknown.length}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">
              {unknown.map((face) => (
                <UnknownFaceCard
                  key={face.id}
                  face={face}
                  onOpen={() => setPreviewFace(face)}
                  onName={() => {
                    setNamingFace(face);
                    setPreviewFace(null);
                    setNameDraft("");
                  }}
                  onDelete={() => deleteFace(face.id).then(refresh)}
                />
              ))}
              {unknown.length === 0 && !unknownQ.isLoading && <EmptyState text="No hay rostros desconocidos" />}
            </div>
          </section>
        </div>

        <aside className="flex min-h-0 flex-col gap-4">
          <RegisterPanel onSuccess={refresh} />
          <FaceProfile face={selectedFace} appearances={appearancesQ.data ?? []} onChanged={refresh} />
        </aside>
      </div>

      {namingFace && (
        <NameModal
          face={namingFace}
          value={nameDraft}
          knownNames={known.map((face) => face.person_name)}
          isSaving={identifyMut.isLoading}
          onChange={setNameDraft}
          onClose={() => setNamingFace(null)}
          onSave={() => identifyMut.mutate()}
        />
      )}

      {previewFace && (
        <UnknownPreviewModal
          face={previewFace}
          onClose={() => setPreviewFace(null)}
          onName={() => {
            setNamingFace(previewFace);
            setPreviewFace(null);
            setNameDraft("");
          }}
          onDelete={() => {
            deleteFace(previewFace.id).then(() => {
              setPreviewFace(null);
              refresh();
            });
          }}
        />
      )}
    </div>
  );
}

function KnownFaceCard({
  face,
  active,
  onClick,
  onChanged,
}: {
  face: RegisteredFace;
  active: boolean;
  onClick: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(face.person_name);
  const renameMut = useMutation(() => renameFace(face.id, draft.trim()), {
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group overflow-hidden rounded border bg-[var(--bg-1)] text-left transition hover:border-[var(--acc)] ${
        active ? "border-[var(--acc)]" : "border-[var(--line)]"
      }`}
    >
      <FaceImage faceId={face.id} className="aspect-[4/3] w-full bg-[var(--bg-2)] object-cover" />
      <div className="space-y-2 p-3">
        {editing ? (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1 text-xs text-[var(--text-0)] outline-none"
              autoFocus
            />
            <button
              type="button"
              disabled={!draft.trim() || renameMut.isLoading}
              onClick={() => renameMut.mutate()}
              className="vms-btn primary !h-7 !min-h-0 !px-2 !text-[10px]"
            >
              OK
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-sm font-semibold text-[var(--text-0)]">{face.person_name}</div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDraft(face.person_name);
                setEditing(true);
              }}
              className="rounded px-2 py-1 text-[10px] text-[var(--text-3)] opacity-0 hover:bg-[var(--bg-2)] group-hover:opacity-100"
            >
              Renombrar
            </button>
          </div>
        )}
        <div className="text-[11px] text-[var(--text-3)]">Detectado {detectionTime(face.created_at)}</div>
      </div>
    </button>
  );
}

function UnknownFaceCard({
  face,
  onOpen,
  onName,
  onDelete,
}: {
  face: UnknownFace;
  onOpen: () => void;
  onName: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="overflow-hidden rounded border border-[var(--line)] bg-[var(--bg-1)]">
      <button type="button" onClick={onOpen} className="block w-full">
        <FaceImage faceId={face.id} className="aspect-square w-full bg-[var(--bg-2)] object-cover transition group-hover:scale-[1.02]" />
      </button>
      <div className="space-y-2 p-2">
        <div className="text-xs font-medium text-[var(--text-1)]">Desconocido</div>
        <div className="text-[10px] text-[var(--text-3)]">{detectionTime(face.created_at)}</div>
        <button type="button" onClick={onName} className="vms-btn primary w-full !h-7 !min-h-0 !text-[10px]">
          Registrar nombre
        </button>
        <button type="button" onClick={onDelete} className="w-full text-[10px] text-[var(--text-3)] hover:text-[var(--warn)]">
          Descartar
        </button>
      </div>
    </div>
  );
}

function UnknownPreviewModal({
  face,
  onClose,
  onName,
  onDelete,
}: {
  face: UnknownFace;
  onClose: () => void;
  onName: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded border border-[var(--line)] bg-[var(--bg-1)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <FaceImage faceId={face.id} className="max-h-[70vh] w-full bg-black object-contain" />
        <div className="flex items-center justify-between gap-3 p-4">
          <div>
            <div className="text-sm font-semibold text-[var(--text-0)]">Rostro desconocido</div>
            <div className="text-xs text-[var(--text-3)]">Detectado {detectionTime(face.created_at)}</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onDelete} className="vms-btn !text-xs !text-[var(--warn)]">
              Descartar
            </button>
            <button type="button" onClick={onName} className="vms-btn primary !text-xs">
              Registrar nombre
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FaceProfile({
  face,
  appearances,
  onChanged,
}: {
  face: RegisteredFace | null;
  appearances: FaceAppearance[];
  onChanged: () => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of appearances) map.set(item.camera_name, (map.get(item.camera_name) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [appearances]);

  if (!face) return <div className="vms-card p-4 text-sm text-[var(--text-3)]">Selecciona un rostro.</div>;

  return (
    <div className="vms-card overflow-hidden">
      <FaceImage faceId={face.id} className="aspect-[4/3] w-full bg-[var(--bg-2)] object-cover" />
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-[var(--text-0)]">{face.person_name}</div>
            <div className="text-xs text-[var(--text-3)]">{appearances.length} apariciones</div>
          </div>
          <button
            type="button"
            onClick={() => deleteFace(face.id).then(onChanged)}
            className="rounded px-2 py-1 text-[10px] text-[var(--text-3)] hover:bg-[var(--bg-2)] hover:text-[var(--warn)]"
          >
            Eliminar
          </button>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-[var(--text-1)]">Camaras</div>
          <div className="space-y-2">
            {grouped.map(([camera, count]) => (
              <div key={camera} className="flex items-center justify-between rounded bg-[var(--bg-2)] px-3 py-2">
                <span className="truncate text-xs text-[var(--text-1)]">{cleanCamera(camera)}</span>
                <span className="text-xs font-semibold text-[var(--text-0)]">{count}</span>
              </div>
            ))}
            {grouped.length === 0 && <div className="text-xs text-[var(--text-3)]">Sin recorrido todavia.</div>}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-[var(--text-1)]">Recorrido</div>
          <div className="max-h-64 space-y-2 overflow-auto pr-1">
            {appearances.map((item, index) => (
              <div key={`${item.created_at}-${index}`} className="border-l border-[var(--line)] pl-3">
                <div className="text-xs font-medium text-[var(--text-0)]">{cleanCamera(item.camera_name)}</div>
                <div className="text-[11px] text-[var(--text-3)]">{fmt(item.created_at)}</div>
              </div>
            ))}
            {appearances.length === 0 && <div className="text-xs text-[var(--text-3)]">No hay apariciones para este nombre.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function NameModal({
  face,
  value,
  knownNames,
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  face: UnknownFace;
  value: string;
  knownNames: string[];
  isSaving: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded border border-[var(--line)] bg-[var(--bg-1)]" onClick={(e) => e.stopPropagation()}>
        <FaceImage faceId={face.id} className="aspect-[4/3] w-full bg-[var(--bg-2)] object-cover" />
        <div className="space-y-3 p-4">
          <div className="text-sm font-semibold text-[var(--text-0)]">Registrar nombre</div>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            list="known-face-names"
            placeholder="Nombre"
            autoFocus
            className="h-9 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
          />
          <datalist id="known-face-names">
            {Array.from(new Set(knownNames)).map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="vms-btn flex-1 !text-xs">
              Cancelar
            </button>
            <button type="button" disabled={!value.trim() || isSaving} onClick={onSave} className="vms-btn primary flex-1 !text-xs">
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RegisterPanel({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const registerMut = useMutation(
    () => {
      const fd = new FormData();
      fd.append("face_name", name.trim());
      fd.append("person_name", name.trim());
      fd.append("image", file!);
      return registerFace(fd);
    },
    {
      onSuccess: () => {
        setName("");
        setFile(null);
        setPreview(null);
        setErr(null);
        onSuccess();
      },
      onError: (e: { response?: { data?: { detail?: string } } }) => {
        setErr(e.response?.data?.detail ?? "Error al registrar");
      },
    },
  );

  function handleFile(f: File) {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  return (
    <div className="vms-card p-4">
      <div className="mb-3 text-sm font-semibold text-[var(--text-0)]">Agregar rostro</div>
      <button
        type="button"
        className="mb-3 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded border border-dashed border-[var(--line)] bg-[var(--bg-2)] text-xs text-[var(--text-3)] hover:border-[var(--acc)]"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f?.type.startsWith("image/")) handleFile(f);
        }}
      >
        {preview ? <img src={preview} alt="Vista previa" className="h-full w-full object-cover" /> : "Subir foto"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre"
        className="mb-2 h-9 w-full rounded border border-[var(--line)] bg-[var(--bg-2)] px-3 text-sm text-[var(--text-0)] outline-none focus:border-[var(--acc)]"
      />
      {err && <p className="mb-2 text-[11px] text-[var(--warn)]">{err}</p>}
      <button
        type="button"
        disabled={!name.trim() || !file || registerMut.isLoading}
        onClick={() => registerMut.mutate()}
        className="vms-btn primary w-full !text-xs disabled:opacity-50"
      >
        Registrar
      </button>
    </div>
  );
}

function FaceImage({ faceId, className }: { faceId: number; className: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setSrc(null);

    getFaceImageUrl(faceId, true)
      .then((url) => {
        objectUrl = url;
        if (alive) setSrc(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (alive) setSrc(null);
      });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [faceId]);

  if (!src) return <div className={`${className} flex items-center justify-center text-xs text-[var(--text-3)]`}>Sin imagen</div>;
  return <img src={src} alt="Rostro" className={className} />;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="col-span-full rounded border border-[var(--line)] bg-[var(--bg-1)] p-8 text-center text-sm text-[var(--text-3)]">
      {text}
    </div>
  );
}
