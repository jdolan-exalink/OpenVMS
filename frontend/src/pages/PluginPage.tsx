import { lazy, Suspense } from "react";
import { useParams } from "react-router-dom";

const PAGE_REGISTRY: Record<string, React.LazyExoticComponent<() => JSX.Element>> = {
  lpr: lazy(() => import("./plugins/LprPage")),
  people_counting: lazy(() => import("./plugins/PeopleCountingPage")),
  face_recognition: lazy(() => import("./plugins/FaceRecognitionPage")),
  notifications: lazy(() => import("./plugins/NotificationsPage")),
  loitering: lazy(() => import("./plugins/LoiteringPage")),
  fall_detection: lazy(() => import("./plugins/FallDetectionPage")),
  line_crossing: lazy(() => import("./plugins/LineCrossingPage")),
  camera_sabotage: lazy(() => import("./plugins/CameraSabotagePage")),
  ai_summary: lazy(() => import("./plugins/AISummaryPage")),
  ocr_general: lazy(() => import("./plugins/OcrPage")),
  lpr_advanced: lazy(() => import("./plugins/LprAdvancedPage")),
  epp: lazy(() => import("./plugins/EppPage")),
  smoke_fire: lazy(() => import("./plugins/SmokeFirePage")),
  abandoned_object: lazy(() => import("./plugins/AbandonedObjectPage")),
  semantic_search: lazy(() => import("./plugins/SemanticSearchPage")),
};

export default function PluginPage() {
  const { pluginName } = useParams<{ pluginName: string }>();
  const Page = pluginName ? PAGE_REGISTRY[pluginName] : undefined;

  if (!Page) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="text-5xl">🔌</span>
        <p className="text-sm text-[var(--text-2)]">Plugin <span className="mono font-semibold text-[var(--text-0)]">{pluginName}</span> no tiene página de interfaz.</p>
        <p className="text-xs text-[var(--text-3)]">Puedes configurarlo desde Settings → Plugins.</p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <span className="text-xs text-[var(--text-3)]">Cargando plugin…</span>
        </div>
      }
    >
      <Page />
    </Suspense>
  );
}
