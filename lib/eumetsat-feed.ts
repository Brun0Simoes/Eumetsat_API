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

function matchGuideTagValue(block: string, tagName: string, preserveMarkup = false) {
  // Event fields precede metadata that can contain tags with the same names.
  const raw = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`))?.[1];
  return preserveMarkup ? raw ? decodeGuideXmlEntities(raw) : null : cleanGuideXmlText(raw);
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

function normalizeGuideUrl(value: string | null) {
  if (!value) {
    return null;
  }

  const bareDomain = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i;

  try {
    const url = new URL(bareDomain.test(value) ? `https://${value}` : value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function extractGuideFirstUrl(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/https?:\/\/[^\s<>"')\]]+/i);
  return normalizeGuideUrl(match?.[0] ?? null);
}

function normalizeGuideFormat(rawFormat: string | null) {
  return rawFormat?.toUpperCase().includes("ONLINE") ? "ONLINE" : "ONSITE";
}

function guideText(value: unknown): string | null {
  return typeof value === "string" ? cleanGuideXmlText(value) || null : null;
}

function guideValue(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return guideText((value as Record<string, unknown>).value);
  }

  return guideText(value);
}

function guideDate(value: unknown): string | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") {
    return null;
  }

  const date = new Date(typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function mapGuideJsonEvent(value: unknown): GuideExternalTrainingEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const event = value as Record<string, unknown>;
  const title = guideText(event.title);
  const startDate = guideDate(event.startDate);
  const endDate = guideDate(event.endDate);

  if (!title || !startDate || !endDate || endDate < startDate) {
    return null;
  }

  const country = event.country && typeof event.country === "object"
    ? event.country as Record<string, unknown>
    : null;
  const city = guideText(event.city);
  const isOnline = [city, guideText(country?.name), guideText(country?.id), guideText(event.country)]
    .some((location) => location?.toUpperCase() === "ONLINE");
  const rawFormat = guideText(event.format);

  return {
    id: `${title}-${startDate}`,
    title,
    startDate,
    endDate,
    rawFormat: isOnline ? "ONLINE" : rawFormat ?? "UNKNOWN",
    eventType: guideValue(event.eventType) ?? "Event",
    status: guideValue(event.status) ?? "Scheduled",
    attendance: guideValue(event.attendance),
    city,
    host: guideText(event.host),
    contactUrl: normalizeGuideUrl(guideText(event.contactUrl)),
    registrationUrl: extractGuideFirstUrl(
      typeof event.registrationHowto === "string" ? decodeGuideXmlEntities(event.registrationHowto) : null,
    ),
    description: guideText(event.description),
    languages: (Array.isArray(event.language) ? event.language : [event.language])
      .map(guideValue)
      .filter((language): language is string => Boolean(language)),
  };
}

function parseGuideEumetsatEventBlock(block: string): GuideExternalTrainingEvent | null {
  const title = matchGuideTagValue(block, "title");
  const startDate = guideDate(matchGuideTagValue(block, "startDate"));
  const endDate = guideDate(matchGuideTagValue(block, "endDate"));

  if (!title || !startDate || !endDate || endDate < startDate) {
    return null;
  }

  const city = matchGuideTagValue(block, "city");
  const country = matchGuideNestedValue(block, "country", "name");
  const isOnline = [city, country].some((location) => location?.toUpperCase() === "ONLINE");

  return {
    id: `${title}-${startDate}`,
    title,
    startDate,
    endDate,
    rawFormat: isOnline ? "ONLINE" : matchGuideTagValue(block, "format") ?? "UNKNOWN",
    eventType: matchGuideNestedValue(block, "eventType", "value") ?? "Event",
    status: matchGuideNestedValue(block, "status", "value") ?? "Scheduled",
    attendance: matchGuideNestedValue(block, "attendance", "value"),
    city,
    host: matchGuideTagValue(block, "host"),
    contactUrl: normalizeGuideUrl(matchGuideTagValue(block, "contactUrl")),
    registrationUrl: extractGuideFirstUrl(matchGuideTagValue(block, "registrationHowto", true)),
    description: matchGuideTagValue(block, "description"),
    languages: Array.from(
      block.matchAll(/<language>[\s\S]*?<value>([\s\S]*?)<\/value>[\s\S]*?<\/language>/g),
    )
      .map((match) => cleanGuideXmlText(match[1]))
      .filter((value): value is string => Boolean(value)),
  };
}

function parseGuideFeed(body: string): GuideExternalTrainingEvent[] {
  const content = body.trim();
  let events: (GuideExternalTrainingEvent | null)[];

  if (content.startsWith("[") || content.startsWith("{")) {
    const payload: unknown = JSON.parse(content);

    if (!Array.isArray(payload)) {
      throw new Error("Unexpected Guide EUMETSAT JSON feed: expected an array.");
    }

    events = payload.map(mapGuideJsonEvent);
  } else {
    const xml = content.replace(/^<\?xml\b[^?]*\?>\s*/, "");
    if (/^<events\s*\/>$/.test(xml)) {
      return [];
    }

    const body = xml.match(/^<events(?:\s[^>]*)?>([\s\S]*)<\/events>$/)?.[1];
    const eventPattern = /<event>([\s\S]*?)<\/event>/g;
    if (body === undefined || body.replace(eventPattern, "").trim()) {
      throw new Error("Unexpected Guide EUMETSAT feed format.");
    }

    events = Array.from(body.matchAll(eventPattern))
      .map((match) => parseGuideEumetsatEventBlock(match[1]));
  }

  const seen = new Set<string>();

  return events
    .filter((event): event is GuideExternalTrainingEvent => Boolean(event))
    .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime())
    .filter((event) => {
      const key = JSON.stringify([event.title, event.startDate]);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
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
        Accept: "application/json,application/xml;q=0.9,text/xml;q=0.8",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Guide EUMETSAT request failed with status ${response.status}.`);
    }

    return parseGuideFeed(await response.text());
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
    hasData: cacheState.events !== null,
    lastErrorAt: cacheState.lastErrorAt ? new Date(cacheState.lastErrorAt).toISOString() : null,
  };
}

export function ensureGuideCalendarRefresh(force = false) {
  const cacheState = getGuideCalendarCache();
  const isStale = !cacheState.updatedAt || Date.now() - cacheState.updatedAt > GUIDE_CALENDAR_CACHE_TTL_MS;

  if (!force && !isStale && cacheState.events !== null) {
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
    void ensureGuideCalendarRefresh().catch(() => undefined);
    return snapshot.events;
  }

  return ensureGuideCalendarRefresh(true);
}
