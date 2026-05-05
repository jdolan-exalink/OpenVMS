import { useEventStore } from "../../store/eventStore";
import EventFeed from "./EventFeed";

export default function EventSidebar() {
  const isPanelOpen = useEventStore((s) => s.isPanelOpen);
  const togglePanel = useEventStore((s) => s.togglePanel);
  const events = useEventStore((s) => s.events);

  return (
    <aside className={`vms-event-panel${isPanelOpen ? " open" : ""}`} aria-hidden={!isPanelOpen}>
        <div className="ep-header">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14" style={{ color: "var(--acc)" }}>
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-0)]">
            Eventos
          </span>
          {events.length > 0 && (
            <span className="mono ml-1 rounded-full bg-[var(--acc-soft)] px-1.5 py-px text-[10px] text-[var(--acc-strong)]">
              {events.length}
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            className="vms-btn !h-7 !min-h-0 !px-2 !text-[11px]"
            onClick={togglePanel}
            title="Cerrar panel de eventos"
          >
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <EventFeed />
      </aside>
  );
}