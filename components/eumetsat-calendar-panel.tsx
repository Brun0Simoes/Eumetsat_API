"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, LoaderCircle } from "lucide-react";

import type { GuideCalendarEvent, GuideCalendarFormatFilter } from "../lib/calendar-types";
import {
  GUIDE_FORMAT_FILTERS,
  createGuideMonthGrid,
  createGuideWeekdayLabels,
  filterGuideCalendarEvents,
  getGuideDefaultSelectedDay,
  getGuideMonthKey,
  startOfGuideUtcMonth,
  toGuideDayKey,
} from "../lib/calendar-utils";
import styles from "./eumetsat-calendar-panel.module.css";

type EumetsatCalendarPanelProps = {
  initialEvents: GuideCalendarEvent[];
  initialUpdatedAt: string | null;
};

type GuideCalendarPayload = {
  events: GuideCalendarEvent[];
  updatedAt: string | null;
  loading: boolean;
  lastErrorAt: string | null;
};

const GUIDE_WARMUP_INTERVAL_MS = 5 * 1000;
const GUIDE_REFRESH_INTERVAL_MS = 60 * 1000;

function changeGuideMonth(month: Date, direction: "previous" | "next") {
  const delta = direction === "previous" ? -1 : 1;
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1));
}

function getDayButtonClassName(options: {
  isSelected: boolean;
  isCurrentMonth: boolean;
}) {
  if (options.isSelected) {
    return `${styles.dayButton} ${styles.dayButtonSelected}`;
  }

  if (options.isCurrentMonth) {
    return `${styles.dayButton} ${styles.dayButtonCurrentMonth}`;
  }

  return `${styles.dayButton} ${styles.dayButtonMuted}`;
}

function getFormatBadgeClassName(format: GuideCalendarEvent["format"]) {
  return format === "ONLINE" ? styles.badgeOnline : styles.badgeOnsite;
}

function getEventDotClassName(event: GuideCalendarEvent) {
  if (event.format === "ONLINE") {
    return `${styles.eventDot} ${styles.eventDotOnline}`;
  }

  return `${styles.eventDot} ${styles.eventDotOnsite}`;
}

export function EumetsatCalendarPanel({
  initialEvents,
  initialUpdatedAt,
}: EumetsatCalendarPanelProps) {
  const initialMonth = startOfGuideUtcMonth(new Date());
  const [events, setEvents] = useState(initialEvents);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [loading, setLoading] = useState(initialEvents.length === 0);
  const [loadError, setLoadError] = useState(false);
  const [formatFilter, setFormatFilter] = useState<GuideCalendarFormatFilter>("ALL");
  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const [selectedDay, setSelectedDay] = useState(() => getGuideDefaultSelectedDay(initialEvents, initialMonth, "ALL"));

  const monthFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    [],
  );

  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        dateStyle: "full",
        timeZone: "UTC",
      }),
    [],
  );

  const eventTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      }),
    [],
  );

  const weekdayLabels = useMemo(() => createGuideWeekdayLabels("en-US"), []);

  useEffect(() => {
    let disposed = false;
    let refreshTimer: number | null = null;
    let activeController: AbortController | null = null;

    async function refreshCalendar() {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      let shouldKeepLoading = events.length === 0;
      let hasEventsForScheduling = events.length > 0;

      try {
        // Use lightweight polling plus focus revalidation to keep the calendar
        // fresh without turning the page into a constant stream or blocking the
        // rest of the UI while the upstream XML feed is being processed.
        const response = await fetch("/api/eumetsat-calendar/events", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Guide calendar request failed: ${response.status}`);
        }

        const payload = (await response.json()) as GuideCalendarPayload;

        if (disposed) {
          return;
        }

        if (payload.events.length) {
          setEvents(payload.events);
          hasEventsForScheduling = true;
        }

        setUpdatedAt(payload.updatedAt);
        shouldKeepLoading = payload.loading && payload.events.length === 0;
        setLoading(shouldKeepLoading);
        setLoadError(false);
      } catch {
        if (!disposed) {
          setLoadError(true);
          setLoading(false);
        }
      } finally {
        if (activeController === controller) {
          activeController = null;
        }
      }

      if (!disposed) {
        const nextDelay = hasEventsForScheduling ? GUIDE_REFRESH_INTERVAL_MS : GUIDE_WARMUP_INTERVAL_MS;
        refreshTimer = window.setTimeout(() => {
          void refreshCalendar();
        }, nextDelay);
      }
    }

    void refreshCalendar();

    const handleFocus = () => {
      void refreshCalendar();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshCalendar();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      activeController?.abort();
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [events.length]);

  const filteredEvents = useMemo(() => {
    return filterGuideCalendarEvents(events, { formatFilter });
  }, [events, formatFilter]);

  const currentMonthKey = getGuideMonthKey(currentMonth);

  const monthEvents = useMemo(() => {
    return filterGuideCalendarEvents(events, {
      monthKey: currentMonthKey,
      formatFilter,
    });
  }, [currentMonthKey, events, formatFilter]);

  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, GuideCalendarEvent[]>();

    for (const event of filteredEvents) {
      const dayKey = toGuideDayKey(event.startDate);
      const current = grouped.get(dayKey) ?? [];
      current.push(event);
      grouped.set(dayKey, current);
    }

    return grouped;
  }, [filteredEvents]);

  useEffect(() => {
    setSelectedDay((previousSelectedDay) => {
      if (previousSelectedDay && eventsByDay.has(previousSelectedDay)) {
        return previousSelectedDay;
      }

      return getGuideDefaultSelectedDay(events, currentMonth, formatFilter);
    });
  }, [currentMonth, events, eventsByDay, formatFilter]);

  const visibleDays = useMemo(() => createGuideMonthGrid(currentMonth), [currentMonth]);
  const selectedEvents = eventsByDay.get(selectedDay) ?? [];
  const exportHref = `/api/eumetsat-calendar/export?month=${currentMonthKey}&format=${formatFilter}`;

  function syncGuideSelection(
    nextMonth: Date,
    nextFormatFilter: GuideCalendarFormatFilter,
  ) {
    setSelectedDay(getGuideDefaultSelectedDay(events, nextMonth, nextFormatFilter));
  }

  function moveMonth(direction: "previous" | "next") {
    const nextMonth = changeGuideMonth(currentMonth, direction);
    setCurrentMonth(nextMonth);
    syncGuideSelection(nextMonth, formatFilter);
  }

  function selectFormatFilter(nextFilter: GuideCalendarFormatFilter) {
    setFormatFilter(nextFilter);
    syncGuideSelection(currentMonth, nextFilter);
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.eyebrow}>EUMETSAT feed</p>
          <h1 className={styles.title}>Training calendar</h1>
          {updatedAt ? (
            <p className={styles.updatedAt}>
              Updated{" "}
              {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(updatedAt),
              )}
            </p>
          ) : null}
        </div>

        <a className={styles.exportLink} href={exportHref}>
          <Download className={styles.inlineIcon} />
          Export month
        </a>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterRow}>
          {GUIDE_FORMAT_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => selectFormatFilter(filter)}
              className={filter === formatFilter ? `${styles.chip} ${styles.chipAccent}` : styles.chip}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.layout}>
        <section className={styles.calendarCard}>
          <div className={styles.monthHeader}>
            <button type="button" aria-label="Previous month" onClick={() => moveMonth("previous")} className={styles.iconButton}>
              <ChevronLeft className={styles.inlineIcon} />
            </button>

            <div className={styles.monthSummary}>
              <p className={styles.monthCount}>{monthEvents.length} events</p>
              <p className={styles.monthLabel}>{monthFormatter.format(currentMonth)}</p>
            </div>

            <button type="button" aria-label="Next month" onClick={() => moveMonth("next")} className={styles.iconButton}>
              <ChevronRight className={styles.inlineIcon} />
            </button>
          </div>

          <div className={styles.weekdays}>
            {weekdayLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          {loading ? (
            <div className={styles.stateBox}>
              <LoaderCircle className={`${styles.inlineIcon} ${styles.spinningIcon}`} />
              <p>Loading calendar</p>
            </div>
          ) : (
            <div className={styles.dayGrid}>
              {visibleDays.map((day) => {
                const dayKey = toGuideDayKey(day);
                const dayEvents = eventsByDay.get(dayKey) ?? [];
                const isCurrentMonth = day.getUTCMonth() === currentMonth.getUTCMonth();
                const isSelected = dayKey === selectedDay;
                const isToday = dayKey === toGuideDayKey(new Date());

                return (
                  <button
                    key={dayKey}
                    type="button"
                    onClick={() => setSelectedDay(dayKey)}
                    className={getDayButtonClassName({ isSelected, isCurrentMonth })}
                  >
                    <div className={styles.dayTop}>
                      <span className={isToday ? `${styles.dayNumber} ${styles.dayNumberToday}` : styles.dayNumber}>
                        {day.getUTCDate()}
                      </span>
                      {dayEvents.length ? <span className={styles.dayCounter}>{dayEvents.length}</span> : null}
                    </div>

                    <div className={styles.dayDots}>
                      {dayEvents.slice(0, 3).map((event) => (
                        <span key={event.id} className={getEventDotClassName(event)} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className={styles.sideColumn}>
          <div className={styles.selectedDayCard}>
            <p className={styles.selectedLabel}>Selected day</p>
            <p className={styles.selectedValue}>{dayFormatter.format(new Date(`${selectedDay}T12:00:00Z`))}</p>
          </div>

          {loadError && events.length === 0 ? (
            <div className={styles.stateBox}>Feed unavailable.</div>
          ) : selectedEvents.length ? (
            selectedEvents.map((event) => (
              <article key={event.id} className={styles.eventCard}>
                <div className={styles.eventHeader}>
                  <div className={styles.eventMeta}>
                    <span className={styles.badge}>{event.eventType}</span>
                    <span className={`${styles.badge} ${getFormatBadgeClassName(event.format)}`}>{event.format}</span>
                  </div>

                  {event.url ? (
                    <a href={event.url} target="_blank" rel="noreferrer" className={styles.eventLink}>
                      <ExternalLink className={styles.inlineIcon} />
                      Open
                    </a>
                  ) : null}
                </div>

                <h2 className={styles.eventTitle}>{event.title}</h2>

                <div className={styles.eventFacts}>
                  <p>{eventTimeFormatter.format(new Date(event.startDate))}</p>
                  {event.host ? <p>{event.host}</p> : null}
                  <p>{event.city ?? (event.format === "ONLINE" ? "Online" : "On site")}</p>
                </div>
              </article>
            ))
          ) : (
            <div className={styles.stateBox}>No events for this day.</div>
          )}
        </aside>
      </div>
    </section>
  );
}
