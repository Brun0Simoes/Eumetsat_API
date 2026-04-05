import "server-only";

import type { GuideCalendarEvent, GuideExternalTrainingEvent } from "./calendar-types";

const GUIDE_EUMETSAT_EVENTS_ENDPOINT = "https://trainingevents.eumetsat.int/trapi/resources/public/events";
const GUIDE_CALENDAR_CACHE_TTL_MS = 2 * 60 * 1000;
const GUIDE_EUMETSAT_TIMEOUT_MS = 20 * 1000;

type GuideCalendarCacheState = {
  events: GuideCalendarEvent[] | null;
  updatedAt: number;
  refreshPromise: Promise<GuideCalendarEvent[]> | null;
  lastErrorAt: number | null;
};

const globalForGuideCalendar = globalThis as typeof globalThis & {
  __eumetsatGuideCalendarCache?: GuideCalendarCacheState;
};

function decodeGuideXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function cleanGuideXmlText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return decodeGuideXmlEntities(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchGuideAllTagValues(block: string, tagName: string) {
  return Array.from(block.matchAll(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "g")))
    .map((match) => cleanGuideXmlText(match[1]))
    .filter((value): value is string => Boolean(value));
}

function matchGuideLastTagValue(block: string, tagName: string) {
  const matches = matchGuideAllTagValues(block, tagName);
  return matches.at(-1) ?? null;
}

function matchGuideNestedValue(block: string, containerTag: string, nestedTag: string) {
  const match = block.match(
    new RegExp(
      `<${containerTag}>[\\s\\S]*?<${nestedTag}>([\\s\\S]*?)</${nestedTag}>[\\s\\S]*?</${containerTag}>`,
      "i",
    ),
  );

  return cleanGuideXmlText(match?.[1]);
}

function extractGuideFirstUrl(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match?.[0] ?? null;
}

function normalizeGuideFormat(rawFormat: string | null) {
  return rawFormat?.toUpperCase().includes("ONLINE") ? "ONLINE" : "ONSITE";
}

function parseGuideEumetsatEventBlock(block: string): GuideExternalTrainingEvent | null {
  // The EUMETSAT endpoint returns raw XML. Normalize it on the server so the
  // client always receives a stable and predictable JSON contract.
  const title = matchGuideLastTagValue(block, "title");
  const startDate = matchGuideLastTagValue(block, "startDate");
  const endDate = matchGuideLastTagValue(block, "endDate");

  if (!title || !startDate || !endDate) {
    return null;
  }

  return {
    id: `${title}-${startDate}`,
    title,
    startDate,
    endDate,
    rawFormat: matchGuideLastTagValue(block, "format") ?? "UNKNOWN",
    eventType: matchGuideNestedValue(block, "eventType", "value") ?? "Event",
    status: matchGuideNestedValue(block, "status", "value") ?? "Scheduled",
    attendance: matchGuideNestedValue(block, "attendance", "value"),
    city: matchGuideLastTagValue(block, "city"),
    host: matchGuideLastTagValue(block, "host"),
    contactUrl: matchGuideLastTagValue(block, "contactUrl"),
    registrationUrl: extractGuideFirstUrl(matchGuideLastTagValue(block, "registrationHowto")),
    description: matchGuideLastTagValue(block, "description"),
    languages: Array.from(
      block.matchAll(/<language>[\s\S]*?<value>([\s\S]*?)<\/value>[\s\S]*?<\/language>/g),
    )
      .map((match) => cleanGuideXmlText(match[1]))
      .filter((value): value is string => Boolean(value)),
  };
}

function getGuideCalendarCache() {
  if (!globalForGuideCalendar.__eumetsatGuideCalendarCache) {
    globalForGuideCalendar.__eumetsatGuideCalendarCache = {
      events: null,
      updatedAt: 0,
      refreshPromise: null,
      lastErrorAt: null,
    };
  }

  return globalForGuideCalendar.__eumetsatGuideCalendarCache;
}

async function fetchGuidePublicTrainingEvents() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GUIDE_EUMETSAT_TIMEOUT_MS);

  try {
    const response = await fetch(GUIDE_EUMETSAT_EVENTS_ENDPOINT, {
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Guide EUMETSAT request failed with status ${response.status}.`);
    }

    const xml = await response.text();

    return Array.from(xml.matchAll(/<event>([\s\S]*?)<\/event>/g))
      .map((match) => parseGuideEumetsatEventBlock(match[1]))
      .filter((event): event is GuideExternalTrainingEvent => Boolean(event))
      .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime())
      .filter(
        (event, index, events) =>
          events.findIndex(
            (candidate) => candidate.title === event.title && candidate.startDate === event.startDate,
          ) === index,
      );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function loadGuideCalendarEventsFresh() {
  const externalEvents = await fetchGuidePublicTrainingEvents();

  return externalEvents.map((event) => ({
    id: `guide-external-${event.id}`,
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate,
    format: normalizeGuideFormat(event.rawFormat),
    eventType: event.eventType,
    status: event.status,
    attendance: event.attendance,
    city: event.city,
    host: event.host,
    url: event.registrationUrl ?? event.contactUrl,
    description: event.description,
    languages: event.languages,
    sourceName: "EUMETSAT",
  })) as GuideCalendarEvent[];
}

export function getGuideCalendarSnapshot() {
  const cacheState = getGuideCalendarCache();

  return {
    events: cacheState.events ?? [],
    updatedAt: cacheState.updatedAt ? new Date(cacheState.updatedAt).toISOString() : null,
    isRefreshing: Boolean(cacheState.refreshPromise),
    hasData: Boolean(cacheState.events?.length),
    lastErrorAt: cacheState.lastErrorAt ? new Date(cacheState.lastErrorAt).toISOString() : null,
  };
}

export function ensureGuideCalendarRefresh(force = false) {
  const cacheState = getGuideCalendarCache();
  const isStale = !cacheState.updatedAt || Date.now() - cacheState.updatedAt > GUIDE_CALENDAR_CACHE_TTL_MS;

  if (!force && !isStale && cacheState.events?.length) {
    return cacheState.refreshPromise ?? Promise.resolve(cacheState.events);
  }

  if (!cacheState.refreshPromise) {
    cacheState.refreshPromise = loadGuideCalendarEventsFresh()
      .then((events) => {
        cacheState.events = events;
        cacheState.updatedAt = Date.now();
        cacheState.lastErrorAt = null;
        return events;
      })
      .catch((error) => {
        cacheState.lastErrorAt = Date.now();
        throw error;
      })
      .finally(() => {
        cacheState.refreshPromise = null;
      });
  }

  return cacheState.refreshPromise;
}

export async function getGuideCalendarEvents() {
  const snapshot = getGuideCalendarSnapshot();

  if (snapshot.hasData) {
    void ensureGuideCalendarRefresh();
    return snapshot.events;
  }

  return ensureGuideCalendarRefresh(true);
}
