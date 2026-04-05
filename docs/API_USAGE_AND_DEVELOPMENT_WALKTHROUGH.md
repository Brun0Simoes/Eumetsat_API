# API Usage and Development Walkthrough

## Purpose

This document explains two things in a practical way:

1. how to use the EUMETSAT-backed API exposed by this repository;
2. how this standalone application was developed, from upstream feed to dashboard.

The intended audience is international scientific, technical, and engineering teams that want a reusable calendar integration rather than a one-off demo.

## What this repository provides

This repository does **not** scrape the EUMETSAT dashboard HTML.

Instead, it:

- reads the public EUMETSAT training events endpoint;
- parses and normalizes the upstream XML on the server;
- exposes a local JSON API for the front-end;
- renders a month calendar and day detail view;
- exports the currently filtered month to `.ics`.

In practice, the repository acts as a clean adapter between the upstream EUMETSAT feed and a calendar UI that can be embedded into another scientific portal.

## Upstream data source

Primary upstream source:

- [EUMETSAT public training events endpoint](https://trainingevents.eumetsat.int/trapi/resources/public/events)

Supporting references:

- [EUMETSAT dashboard](https://user.eumetsat.int/dashboard)
- [EUMETSAT guide: Getting started using data](https://user.eumetsat.int/resources/user-guides/getting-started-using-data)

## Step 1: run the project locally

From the repository root:

```bash
npm install
npm run dev
```

Then open:

- [http://localhost:3010/eumetsat-calendar](http://localhost:3010/eumetsat-calendar)

There are no environment variables required for the default example.

## Step 2: understand the route structure

This project exposes three relevant routes:

- `/eumetsat-calendar`
- `/api/eumetsat-calendar/events`
- `/api/eumetsat-calendar/export`

### `/eumetsat-calendar`

This is the functional dashboard page. It:

- renders immediately;
- triggers cache warmup in parallel;
- loads fresh data through the local JSON API;
- keeps updating itself without blocking the rest of the page.

### `/api/eumetsat-calendar/events`

This is the normalized JSON feed consumed by the front-end.

Use it when:

- you want to inspect the normalized dataset;
- you want to integrate the same data into another UI;
- you want to validate whether upstream refresh is working.

Example request:

```bash
curl http://localhost:3010/api/eumetsat-calendar/events
```

Example response shape:

```json
{
  "events": [
    {
      "id": "guide-external-Example Event-2026-04-01T09:00:00Z",
      "title": "Example Event",
      "startDate": "2026-04-01T09:00:00Z",
      "endDate": "2026-04-01T11:00:00Z",
      "format": "ONLINE",
      "eventType": "Webinar",
      "status": "Scheduled",
      "attendance": "Open",
      "city": null,
      "host": "EUMETSAT",
      "url": "https://example.org/register",
      "description": "Event description",
      "languages": ["English"],
      "sourceName": "EUMETSAT"
    }
  ],
  "updatedAt": "2026-04-05T18:40:00.000Z",
  "loading": false,
  "lastErrorAt": null
}
```

Field meaning:

- `events`: normalized array returned from the upstream XML feed
- `updatedAt`: last successful cache refresh time in UTC
- `loading`: `true` while the local cache is still warming up or refreshing without data
- `lastErrorAt`: last upstream refresh failure time, if any

### `/api/eumetsat-calendar/export`

This route exports the currently selected month to `.ics`.

Supported query parameters:

- `month=YYYY-MM`
- `format=ALL|ONLINE|ONSITE`

Example request:

```bash
curl "http://localhost:3010/api/eumetsat-calendar/export?month=2026-04&format=ONLINE" -o april-online.ics
```

Example browser URL:

- [http://localhost:3010/api/eumetsat-calendar/export?month=2026-04&format=ALL](http://localhost:3010/api/eumetsat-calendar/export?month=2026-04&format=ALL)

Use this route when:

- you want to import the filtered month into another calendar client;
- you need the same filtered slice visible in the dashboard;
- you want a portable file for workflows outside the web UI.

## Step 3: understand the data flow

The application follows this pipeline:

1. fetch upstream XML from the EUMETSAT public endpoint;
2. extract `<event>` blocks;
3. normalize each event into a typed JSON structure;
4. deduplicate events using `title + startDate`;
5. store the normalized result in in-memory cache;
6. expose the cached result through the local JSON route;
7. let the client UI poll the local route rather than the remote XML endpoint directly.

This separation is important because it keeps the front-end stable even if the upstream XML is noisy, slow, or changes in minor ways.

## Step 4: understand the normalization rules

The local API intentionally simplifies the upstream feed.

Key rules:

- raw XML is converted to a typed JSON contract;
- `ONLINE` stays `ONLINE`;
- non-online event formats are grouped as `ONSITE`;
- `registrationHowto` is scanned for the first usable URL;
- if `registrationHowto` does not contain a URL, `contactUrl` is used as fallback;
- all date math is kept in UTC;
- duplicated events are removed.

This makes the UI logic much simpler and more reproducible.

## Step 5: understand why UTC is used everywhere

This is a scientific and operational design choice, not just a coding preference.

If the same event is grouped using local browser time, users in different countries may see it on different days. That is undesirable for a shared institutional calendar.

To avoid that, this repository uses UTC for:

- month keys;
- day keys;
- month grid generation;
- `.ics` export timestamps.

If your organization wants local-time display, the safest pattern is:

1. keep the data layer in UTC;
2. convert only in the presentation layer;
3. avoid local time for grouping and filtering the base dataset.

## Step 6: understand the refresh strategy

The project is designed to stay updated without making the dashboard feel slow.

Server behavior:

- keeps an in-memory cache snapshot;
- returns the latest cached snapshot immediately;
- refreshes upstream XML in the background.

Client behavior:

- requests the local JSON route on mount;
- polls every `5 seconds` while the cache is still empty;
- switches to every `60 seconds` after data is loaded;
- refreshes when the tab regains focus;
- refreshes when the page becomes visible again.

This keeps the interface fresh without forcing users to wait on every navigation.

## Step 7: understand the repository structure

Main files and their roles:

- `app/eumetsat-calendar/page.tsx`
  Server entry for the calendar page. It renders immediately and triggers background warmup.

- `app/api/eumetsat-calendar/events/route.ts`
  Local JSON endpoint consumed by the browser.

- `app/api/eumetsat-calendar/export/route.ts`
  `.ics` export endpoint with explicit query validation.

- `components/eumetsat-calendar-panel.tsx`
  Interactive calendar UI, month navigation, filters, and day event listing.

- `lib/eumetsat-feed.ts`
  Upstream fetch, timeout handling, XML cleanup, normalization, deduplication, and cache management.

- `lib/calendar-utils.ts`
  UTC-safe date helpers, month grid creation, filter logic, and `.ics` construction.

- `lib/calendar-types.ts`
  Shared TypeScript types for events and filters.

## Step 8: how the application was developed

The application was built in this order:

1. identify the stable public EUMETSAT endpoint instead of scraping the dashboard;
2. inspect the XML structure and isolate the fields needed for the calendar;
3. define a typed normalized event model;
4. implement server-side fetch and XML parsing;
5. add deduplication and URL extraction rules;
6. add an in-memory cache to avoid reparsing XML on every request;
7. expose a local JSON route for front-end consumption;
8. build the standalone calendar page and day detail view;
9. add `.ics` export using the same filtered event slice;
10. add screenshots and technical documentation for reuse by other teams.

That order matters. The UI was built on top of a stable local contract, not directly on the external XML feed.

## Step 9: how to adapt it to your own institution

If you want to reuse this implementation in another portal:

1. keep the upstream fetch adapter isolated in `lib/eumetsat-feed.ts`;
2. preserve the normalized event contract unless you have a strong reason to change it;
3. adjust only the styling layer if you need another look and feel;
4. keep UTC for grouping, filtering, and export;
5. replace in-memory cache with Redis if you need multi-instance deployment;
6. protect the routes only if your host application requires authentication.

## Step 10: how to verify that the integration is healthy

Use this checklist:

1. `npm run dev` starts without errors.
2. `/eumetsat-calendar` renders without blocking.
3. `/api/eumetsat-calendar/events` returns JSON with `events`.
4. `updatedAt` changes after a successful refresh cycle.
5. month navigation changes the event count.
6. format filters change the visible subset.
7. `/api/eumetsat-calendar/export?...` downloads a valid `.ics` file.
8. the page still works when the upstream feed is temporarily unavailable and cached data exists.

## Typical extension points

Common places where teams extend this repository:

- custom styling and branding;
- additional filters such as language or event type;
- institutional authentication around the UI;
- persistent distributed cache;
- observability and metrics for refresh success or upstream downtime;
- alternate export formats in addition to `.ics`.

## Final recommendation

Treat the upstream EUMETSAT XML as a source feed, not as a front-end API contract.

The strength of this repository is the adapter layer:

- upstream XML in;
- normalized JSON out;
- reproducible UTC-safe calendar behavior;
- exportable monthly snapshots.

That separation is what makes the implementation reusable, maintainable, and suitable for institutional scientific environments.
