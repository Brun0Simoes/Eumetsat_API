export type GuideCalendarFormatFilter = "ALL" | "ONLINE" | "ONSITE";

export type GuideCalendarEvent = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  format: "ONLINE" | "ONSITE";
  eventType: string;
  status: string | null;
  attendance: string | null;
  city: string | null;
  host: string | null;
  url: string | null;
  description: string | null;
  languages: string[];
  sourceName: string;
};

export type GuideExternalTrainingEvent = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  rawFormat: string;
  eventType: string;
  status: string;
  attendance: string | null;
  city: string | null;
  host: string | null;
  contactUrl: string | null;
  registrationUrl: string | null;
  description: string | null;
  languages: string[];
};

export type GuideCalendarFilters = {
  monthKey?: string | null;
  formatFilter?: GuideCalendarFormatFilter;
};
