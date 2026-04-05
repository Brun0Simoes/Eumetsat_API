import type {
  GuideCalendarEvent,
  GuideCalendarFilters,
  GuideCalendarFormatFilter,
} from "./calendar-types";

export const GUIDE_FORMAT_FILTERS: GuideCalendarFormatFilter[] = ["ALL", "ONLINE", "ONSITE"];

export function getGuideMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function normalizeGuideMonthKey(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    return null;
  }

  return value;
}

export function toGuideDayKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export function startOfGuideUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export function addGuideUtcDays(value: Date, amount: number) {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate() + amount,
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
    ),
  );
}

export function createGuideMonthGrid(month: Date) {
  // Use UTC end to end so the same event does not drift to another day when
  // the page is opened from different local time zones.
  const firstDayOfMonth = startOfGuideUtcMonth(month);
  const mondayBasedWeekday = (firstDayOfMonth.getUTCDay() + 6) % 7;
  const gridStart = addGuideUtcDays(firstDayOfMonth, -mondayBasedWeekday);

  return Array.from({ length: 42 }, (_, index) => addGuideUtcDays(gridStart, index));
}

export function createGuideWeekdayLabels(locale = "en-US") {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const monday = new Date(Date.UTC(2026, 0, 5));
  return Array.from({ length: 7 }, (_, index) => formatter.format(addGuideUtcDays(monday, index)));
}

export function filterGuideCalendarEvents(
  events: GuideCalendarEvent[],
  filters: GuideCalendarFilters = {},
) {
  const monthKey = normalizeGuideMonthKey(filters.monthKey);
  const formatFilter = filters.formatFilter ?? "ALL";

  return events.filter((event) => {
    if (formatFilter === "ONLINE" && event.format !== "ONLINE") {
      return false;
    }

    if (formatFilter === "ONSITE" && event.format !== "ONSITE") {
      return false;
    }

    if (monthKey && getGuideMonthKey(new Date(event.startDate)) !== monthKey) {
      return false;
    }

    return true;
  });
}

export function getGuideDefaultSelectedDay(
  events: GuideCalendarEvent[],
  month: Date,
  formatFilter: GuideCalendarFormatFilter,
) {
  const monthKey = getGuideMonthKey(month);
  const monthEvents = filterGuideCalendarEvents(events, { monthKey, formatFilter });
  const todayKey = toGuideDayKey(new Date());
  const isCurrentMonth = monthKey === getGuideMonthKey(new Date());
  const nextEvent =
    (isCurrentMonth
      ? monthEvents.find((event) => toGuideDayKey(event.startDate) >= todayKey)
      : null) ?? monthEvents[0];

  return nextEvent ? toGuideDayKey(nextEvent.startDate) : toGuideDayKey(startOfGuideUtcMonth(month));
}

function escapeGuideIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function formatGuideIcsDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function foldGuideIcsLine(line: string) {
  if (line.length <= 73) {
    return line;
  }

  const chunks: string[] = [];

  for (let index = 0; index < line.length; index += 73) {
    const chunk = line.slice(index, index + 73);
    chunks.push(index === 0 ? chunk : ` ${chunk}`);
  }

  return chunks.join("\r\n");
}

function resolveGuideEventUrl(origin: string, url: string | null) {
  if (!url) {
    return null;
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return `${origin.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

export function buildGuideCalendarIcs(events: GuideCalendarEvent[], origin: string) {
  // Generate the `.ics` payload manually so the export stays transparent and
  // matches the exact filtered slice that the calendar UI is showing.
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EUMETSAT Calendar Guide//Standalone Example//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const event of events) {
    const resolvedUrl = resolveGuideEventUrl(origin, event.url);
    const description = [
      event.description,
      event.host ? `Host: ${event.host}` : null,
      event.eventType ? `Type: ${event.eventType}` : null,
      event.sourceName ? `Source: ${event.sourceName}` : null,
      resolvedUrl ? `Link: ${resolvedUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeGuideIcsText(event.id)}@eumetsat-calendar-guide`);
    lines.push(`DTSTAMP:${formatGuideIcsDate(new Date())}`);
    lines.push(`DTSTART:${formatGuideIcsDate(event.startDate)}`);
    lines.push(`DTEND:${formatGuideIcsDate(event.endDate)}`);
    lines.push(`SUMMARY:${escapeGuideIcsText(event.title)}`);
    lines.push(`DESCRIPTION:${escapeGuideIcsText(description)}`);
    lines.push(
      `LOCATION:${escapeGuideIcsText(event.city ?? (event.format === "ONLINE" ? "Online" : "On site"))}`,
    );
    lines.push(`CATEGORIES:${escapeGuideIcsText(event.sourceName)}`);

    if (event.host) {
      lines.push(`ORGANIZER:${escapeGuideIcsText(event.host)}`);
    }

    if (resolvedUrl) {
      lines.push(`URL:${escapeGuideIcsText(resolvedUrl)}`);
    }

    lines.push("STATUS:CONFIRMED");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return `${lines.map(foldGuideIcsLine).join("\r\n")}\r\n`;
}
