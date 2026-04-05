import { EumetsatCalendarPanel } from "../../components/eumetsat-calendar-panel";
import { ensureGuideCalendarRefresh } from "../../lib/eumetsat-feed";

export default async function EumetsatCalendarGuidePage() {
  // Render the shell immediately and warm the remote feed in parallel.
  // This reduces first paint time when the XML payload is large.
  void ensureGuideCalendarRefresh().catch(() => undefined);

  return (
    <main style={{ padding: "2rem 1rem" }}>
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
        <EumetsatCalendarPanel initialEvents={[]} initialUpdatedAt={null} />
      </div>
    </main>
  );
}
