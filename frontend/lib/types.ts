// API Response Types
export interface PedestrianData {
  id: string;
  street: string;
  city: string;
  date: string;
  hour: string;
  weekday: string;
  n_pedestrians: number;
  n_pedestrians_towards: number;
  n_pedestrians_away: number;
  temperature?: number;
  weather_condition?: string;
  incidents: string;
  collection_type: string;
  timestamp?: string;
}

export interface StreetLocation {
  name: string;
  id: string;
  coordinates: {
    lat: number;
    lon: number;
  };
}

export interface StreetsResponse {
  streets: string[];
  count: number;
  details: StreetLocation[];
}

export interface CalendarInfo {
  date: string;
  is_public_holiday: boolean;
  public_holiday_name?: string;
  is_nationwide_holiday: boolean;
  is_school_holiday: boolean;
  school_holiday_name?: string;
  school_holiday_period?: {
    start: string;
    end: string;
  };
  has_event: boolean;
  has_concert: boolean;
  is_jmu_lecture_period: boolean;
  is_thws_lecture_period: boolean;
  is_special_day: boolean;
}

export interface EventInfo {
  event_name: string;
  is_concert: boolean;
  start: string;
  end: string;
}

export interface EventsResponse {
  date: string;
  has_events: boolean;
  event_count: number;
  events: EventInfo[];
}

export interface HistoricalDataResponse {
  street: string;
  period: {
    start: string;
    end: string;
  };
  count: number;
  data: PedestrianData[];
}

export interface StatisticsData {
  totalPedestrians: number;
  avgHourlyCount: number;
  peakHour: number;
  peakCount: number;
  directionRatio: number; // towards vs away
  weatherImpact: 'low' | 'medium' | 'high';
}

export interface DashboardFilters {
  street: string;
  dateRange: {
    type: 'day' | 'week' | 'month';
    start: Date;
    end: Date;
  };
}

// Chart data types
export interface HourlyDataPoint {
  hour: number;
  total: number;
  towards: number;
  away: number;
  date: string;
  isHigh?: boolean; // optional, used for highlighting
}

export interface DailyDataPoint {
  date: string;
  total: number;
  avgHourly: number;
  weekday: string;
}

// Calendar event types
export interface CalendarEvent {
  date: Date;
  type: 'holiday' | 'school_holiday' | 'event' | 'concert' | 'lecture';
  name?: string;
  description?: string;
}
