import { z } from "zod";

import { buildGuideCalendarIcs, filterGuideCalendarEvents } from "../../../../lib/calendar-utils";
import { getGuideCalendarEvents } from "../../../../lib/eumetsat-feed";

const guideExportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  format: z.enum(["ALL", "ONLINE", "ONSITE"]).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const requestHost = request.headers.get("host");
  const publicOrigin =
    forwardedHost || requestHost
      ? `${forwardedProto ?? url.protocol.replace(":", "")}://${forwardedHost ?? requestHost}`
      : url.origin;

  // Validate query parameters explicitly so the exported `.ics` always matches
  // a coherent subset of the same dataset rendered by the calendar UI.
  const parsed = guideExportQuerySchema.safeParse({
    month: url.searchParams.get("month") ?? undefined,
    format: url.searchParams.get("format") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: "Invalid guide calendar export filters." }, { status: 400 });
  }

  const events = await getGuideCalendarEvents();
  const filteredEvents = filterGuideCalendarEvents(events, {
    monthKey: parsed.data.month,
    formatFilter: parsed.data.format ?? "ALL",
  });

  const ics = buildGuideCalendarIcs(filteredEvents, publicOrigin);
  const monthKey = parsed.data.month ?? "all-months";
  const formatKey = (parsed.data.format ?? "all").toLowerCase();
  const fileName = `guide-eumetsat-events-${monthKey}-${formatKey}.ics`;

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
