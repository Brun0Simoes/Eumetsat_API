import { NextResponse } from "next/server";

import { ensureGuideCalendarRefresh, getGuideCalendarSnapshot } from "../../../../lib/eumetsat-feed";

export async function GET() {
  // Return the latest cached snapshot first, then refresh in the background.
  // This keeps navigation fast even when the upstream XML response is slow.
  const snapshot = getGuideCalendarSnapshot();
  void ensureGuideCalendarRefresh(!snapshot.hasData).catch(() => undefined);

  return NextResponse.json(
    {
      events: snapshot.events,
      updatedAt: snapshot.updatedAt,
      loading: snapshot.isRefreshing || !snapshot.hasData,
      lastErrorAt: snapshot.lastErrorAt,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
