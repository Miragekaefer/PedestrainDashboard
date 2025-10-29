'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { TrendingUp, MapPin } from 'lucide-react';
import { DashboardFilters, StatisticsData, HourlyDataPoint, DailyDataPoint, CalendarEvent, PedestrianData } from '@/lib/types';
import { pedestrianAPI } from '@/lib/api';
import { StreetFilter } from './filters/street-filter';
import { DateFilter } from './filters/date-filter';
import { CalendarComponent } from './calendar/calendar-component';
import { DataVisualization } from './charts/data-visualization';
import { StatisticsCards } from './statistics/statistics-cards';
import { ThemeToggle } from './theme-toggle';
import { eachDayOfInterval, format, isAfter } from 'date-fns';

export function Dashboard() {
  const [filters, setFilters] = useState<DashboardFilters>({
    street: 'Kaiserstraße',
    dateRange: {
      type: 'week',
      start: new Date(),
      end: new Date(),
    },
  });

  const [loading, setLoading] = useState(true);
  const [statistics, setStatistics] = useState<StatisticsData | null>(null);
  const [hourlyData, setHourlyData] = useState<HourlyDataPoint[]>([]);
  const [dailyData, setDailyData] = useState<DailyDataPoint[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [streets, setStreets] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [futureEvents, setFutureEvents] = useState<CalendarEvent[]>([]);

  // Load streets on mount
  useEffect(() => {
    const loadStreets = async () => {
      try {
        const response = await pedestrianAPI.getStreets();
        setStreets(response.streets);
      } catch (err) {
        console.error('Failed to load streets:', err);
        setError('Failed to load streets');
      }
    };
    loadStreets();
  }, []);

  // Load future events (once)
  useEffect(() => {
    const loadFutureEvents = async () => {
      try {
        const today = new Date();
        const futureEnd = new Date(today);
        futureEnd.setMonth(futureEnd.getMonth() + 4);

        const dates: Date[] = [];
        const cur = new Date(today);
        cur.setHours(0, 0, 0, 0);
        futureEnd.setHours(0, 0, 0, 0);

        while (cur <= futureEnd) {
          dates.push(new Date(cur));
          cur.setDate(cur.getDate() + 1);
        }

        const promises = dates.map(async (date) => {
          const dateStr = date.toISOString().split('T')[0];
          try {
            const eventsInfo = await pedestrianAPI.getEventsForDate(dateStr);
            const dateEvents: CalendarEvent[] = [];

            if (eventsInfo && Array.isArray(eventsInfo.events)) {
              eventsInfo.events.forEach((evt) => {
                dateEvents.push({
                  date: new Date(date),
                  type: evt.is_concert ? 'concert' : 'event',
                  name: evt.event_name ?? 'Unnamed Event',
                  description: evt.is_concert ? 'Concert' : 'Event',
                });
              });
            }
            return dateEvents;
          } catch {
            return [];
          }
        });

        const allResults = (await Promise.all(promises)).flat();
        allResults.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        setFutureEvents(allResults);
      } catch (err) {
        console.error('Failed to load future events:', err);
        setFutureEvents([]);
      }
    };

    loadFutureEvents();
  }, []);

  // Load data when filters change
  useEffect(() => {
const loadData = async () => {
  if (!filters.street) return;

  setLoading(true);
  setError(null);

  try {
    const { start, end } = filters.dateRange;
    const startDate = start.toISOString().split('T')[0];
    const endDate = end.toISOString().split('T')[0];

    let combinedData: PedestrianData[] = [];
    let combinedStats: StatisticsData = {
      totalPedestrians: 0,
      avgHourlyCount: 0,
      peakHour: 0,
      peakCount: 0,
      directionRatio: 0,
      weatherImpact: 'low'
    };

    if (filters.street === 'All_streets') {
      // Fetch all streets in parallel
      const promises = streets.map(async (street) => {
        const [hist, stats] = await Promise.all([
          pedestrianAPI.getHistoricalData(street, startDate, endDate),
          pedestrianAPI.getStatistics(street, startDate, endDate)
        ]);

        return { hist, stats };
      });

      const results = await Promise.all(promises);

      // Combine all historical data
      results.forEach(({ hist, stats }) => {
        if (hist && Array.isArray(hist.data)) {
          combinedData.push(...hist.data);
        }

        // Combine statistics (averaging where appropriate)
        combinedStats.totalPedestrians += stats.totalPedestrians;
        combinedStats.avgHourlyCount += stats.avgHourlyCount;
        combinedStats.peakCount = Math.max(combinedStats.peakCount, stats.peakCount);
        combinedStats.directionRatio += stats.directionRatio;
      });

      // Average out some metrics
      if (results.length > 0) {
        combinedStats.avgHourlyCount = Math.round(combinedStats.avgHourlyCount / results.length);
        combinedStats.directionRatio = Math.round(combinedStats.directionRatio / results.length);
      }
    } else {
      // Single street
      const [histResp, statsResp] = await Promise.all([
        pedestrianAPI.getHistoricalData(filters.street, startDate, endDate),
        pedestrianAPI.getStatistics(filters.street, startDate, endDate)
      ]);

      combinedData = histResp.data;
      combinedStats = statsResp;
    }

    // Transform for charts
    const hourlyChartData = pedestrianAPI.transformToHourlyData(combinedData);
    const dailyChartData = pedestrianAPI.transformToDailyData(combinedData);

    // Update state
    setStatistics(combinedStats);
    setHourlyData(hourlyChartData);
    setDailyData(fillDailyData(dailyChartData, filters.dateRange.start, filters.dateRange.end));

    await loadCalendarEvents();
  } catch (err) {
    console.error('Failed to load data:', err);
    setError('Failed to load pedestrian data');
  } finally {
    setLoading(false);
  }
};


    loadData();
  }, [filters, streets]);

  // Calendar events loader
  const loadCalendarEvents = async () => {
    const { start, end } = filters.dateRange;
    const dates: Date[] = [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const promises = dates.map(async (date) => {
      const dateStr = date.toISOString().split('T')[0];
      try {
        const [calendarInfo, eventsInfo] = await Promise.all([
          pedestrianAPI.getCalendarInfo(dateStr),
          pedestrianAPI.getEventsForDate(dateStr),
        ]);

        const dateEvents: CalendarEvent[] = [];

        if (calendarInfo.is_public_holiday) {
          dateEvents.push({
            date: new Date(date),
            type: 'holiday',
            name: calendarInfo.public_holiday_name || 'Public Holiday',
            description: calendarInfo.is_nationwide_holiday ? 'National Holiday' : 'Regional Holiday',
          });
        }

        if (calendarInfo.is_school_holiday) {
          dateEvents.push({
            date: new Date(date),
            type: 'school_holiday',
            name: calendarInfo.school_holiday_name || 'School Holiday',
            description: 'School break period',
          });
        }

        if (calendarInfo.is_jmu_lecture_period || calendarInfo.is_thws_lecture_period) {
          dateEvents.push({
            date: new Date(date),
            type: 'lecture',
            name: 'University Lecture Period',
            description: 'Regular semester period',
          });
        }

        if (eventsInfo.has_events) {
          eventsInfo.events.forEach(event => {
            dateEvents.push({
              date: new Date(date),
              type: event.is_concert ? 'concert' : 'event',
              name: event.event_name,
              description: event.is_concert ? 'Concert' : 'Event',
            });
          });
        }

        return dateEvents;
      } catch {
        return [];
      }
    });

    const allEvents = (await Promise.all(promises)).flat();
    setCalendarEvents(allEvents);
  };

  // Filter handlers
  const handleStreetChange = (street: string) => {
    setFilters(prev => ({ ...prev, street }));
  };

  const handleDateRangeChange = (dateRange: DashboardFilters['dateRange']) => {
    setFilters(prev => ({ ...prev, dateRange }));
  };

  // Fill missing daily data
  function fillDailyData(dailyData: DailyDataPoint[], startDate: Date, endDate: Date): DailyDataPoint[] {
    const today = new Date();
    const intervalEnd = isAfter(endDate, today) ? today : endDate;

    const allDates = eachDayOfInterval({ start: startDate, end: intervalEnd }).map(d => format(d, 'yyyy-MM-dd'));

    return allDates.map(date => {
      const existing = dailyData.find(d => d.date === date);
      return existing ?? { date, total: 0, avgHourly: 0, weekday: format(new Date(date), 'EEEE') };
    });
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center text-red-500">
              <p className="text-lg font-semibold">Error Loading Dashboard</p>
              <p className="text-sm mt-2">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700 flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <TrendingUp className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Pedestrian Dashboard</h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">Würzburg Pedestrian Analytics</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Badge variant="outline" className="hidden sm:inline-flex">Live Data</Badge>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 h-full">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 h-full">
            {/* Sidebar - Filters */}
            <div className="lg:col-span-1 h-full overflow-y-auto">
              <Card className="h-full flex flex-col">
                <CardHeader className="flex-shrink-0">
                  <CardTitle className="flex items-center space-x-2">
                    <MapPin className="h-5 w-5" />
                    <span>Filters</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 flex-1 overflow-y-auto">
                  <StreetFilter
                    streets={streets}
                    selectedStreet={filters.street}
                    onStreetChange={handleStreetChange}
                  />

                  <Separator />

                  <DateFilter
                    dateRange={filters.dateRange}
                    onDateRangeChange={handleDateRangeChange}
                  />

                  <Separator />

                  {/* Quick Stats */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Current Selection</h4>
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Street:</span>
                        <Badge variant="secondary">{filters.street}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Period:</span>
                        <Badge variant="secondary">
                          {filters.dateRange.type === 'day' && 'Single Day'}
                          {filters.dateRange.type === 'week' && 'Week'}
                          {filters.dateRange.type === 'month' && 'Month'}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Data Points:</span>
                        <span className="font-medium dark:text-gray-200">{loading ? '...' : dailyData.length}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main Content */}
            <div className="lg:col-span-4 space-y-6 h-full overflow-y-auto">
              <StatisticsCards statistics={statistics} loading={loading} street={filters.street} />

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2">
                  <DataVisualization
                    hourlyData={hourlyData}
                    dailyData={dailyData}
                    loading={loading}
                    dateRange={filters.dateRange}
                  />
                </div>

                <div className="xl:col-span-1">
                  <CalendarComponent
                    events={calendarEvents}
                    loading={loading}
                    futureEvents={futureEvents}
                    dateRange={filters.dateRange}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
