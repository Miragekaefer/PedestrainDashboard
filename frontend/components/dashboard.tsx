'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
function getPeakHourRange(peakHour: number) {
  // Returns a string like "16:00–18:00 Uhr" for a given peak hour (e.g., 16)
  const start = peakHour.toString().padStart(2, '0') + ':00';
  const end = (peakHour + 2).toString().padStart(2, '0') + ':00';
  return `${start}–${end} Uhr`;
}

function getPercentChange(today: number, yesterday: number) {
  if (yesterday === 0) return null;
  const percent = ((today - yesterday) / yesterday) * 100;
  return percent;
}
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CalendarDays, TrendingUp, Users, MapPin } from 'lucide-react';
import { DashboardFilters, StatisticsData, HourlyDataPoint, DailyDataPoint, CalendarEvent } from '@/lib/types';
import { pedestrianAPI } from '@/lib/api';
import { StreetFilter } from './filters/street-filter';
import { DateFilter } from './filters/date-filter';
import { CalendarComponent } from './calendar/calendar-component';
import { DataVisualization } from './charts/data-visualization';
import { HeatmapVisualization } from './charts/heatmap-visualization';
import { StatisticsCards } from './statistics/statistics-cards';
import { ThemeToggle } from './theme-toggle';

export function Dashboard() {
  const [filters, setFilters] = useState<DashboardFilters>({
    street: 'Kaiserstraße',
    dateRange: {
      type: 'week',
      start: new Date(),
      end: new Date()
    }
  });

  const [loading, setLoading] = useState(true);
  const [statistics, setStatistics] = useState<StatisticsData | null>(null);
  const [hourlyData, setHourlyData] = useState<HourlyDataPoint[]>([]);
  const [dailyData, setDailyData] = useState<DailyDataPoint[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [streets, setStreets] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

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

        // Load historical data and statistics
        const [historicalResponse, stats] = await Promise.all([
          pedestrianAPI.getHistoricalData(filters.street, startDate, endDate),
          pedestrianAPI.getStatistics(filters.street, startDate, endDate)
        ]);

        setStatistics(stats);

        // Transform data for charts
        const hourlyChartData = pedestrianAPI.transformToHourlyData(historicalResponse.data);
        const dailyChartData = pedestrianAPI.transformToDailyData(historicalResponse.data);

        setHourlyData(hourlyChartData);
        setDailyData(dailyChartData);

        // Generate calendar events for the date range
        await loadCalendarEvents();

      } catch (err) {
        console.error('Failed to load data:', err);
        setError('Failed to load pedestrian data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [filters]);

  const loadCalendarEvents = async () => {
    const { start, end } = filters.dateRange;

    // Generate array of dates - extend 60 days into the past and future for comprehensive event coverage
    const extendedStart = new Date(start.getTime() - 60 * 24 * 60 * 60 * 1000);
    const extendedEnd = new Date(Math.max(end.getTime(), start.getTime() + 60 * 24 * 60 * 60 * 1000));
    
    const dates: Date[] = [];
    const currentDate = new Date(extendedStart);
    while (currentDate <= extendedEnd) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Fetch all dates in parallel (much faster!)
    const promises = dates.map(async (date) => {
      const dateStr = date.toISOString().split('T')[0];
      try {
        const [calendarInfo, eventsInfo] = await Promise.all([
          pedestrianAPI.getCalendarInfo(dateStr),
          pedestrianAPI.getEventsForDate(dateStr)
        ]);

        const dateEvents: CalendarEvent[] = [];

        // Add different types of events
        if (calendarInfo.is_public_holiday) {
          dateEvents.push({
            date: new Date(date),
            type: 'holiday',
            name: calendarInfo.public_holiday_name || 'Public Holiday',
            description: calendarInfo.is_nationwide_holiday ? 'National Holiday' : 'Regional Holiday'
          });
        }

        if (calendarInfo.is_school_holiday) {
          dateEvents.push({
            date: new Date(date),
            type: 'school_holiday',
            name: calendarInfo.school_holiday_name || 'School Holiday',
            description: 'School break period'
          });
        }

        if (calendarInfo.is_jmu_lecture_period || calendarInfo.is_thws_lecture_period) {
          dateEvents.push({
            date: new Date(date),
            type: 'lecture',
            name: 'University Lecture Period',
            description: 'Regular semester period'
          });
        }

        if (eventsInfo.has_events) {
          eventsInfo.events.forEach(event => {
            dateEvents.push({
              date: new Date(date),
              type: event.is_concert ? 'concert' : 'event',
              name: event.event_name,
              description: event.is_concert ? 'Concert' : 'Event'
            });
          });
        }

        return dateEvents;
      } catch (err) {
        console.error(`Failed to load calendar data for ${dateStr}:`, err);
        return [];
      }
    });

    // Wait for all promises to resolve
    const results = await Promise.all(promises);
    const allEvents = results.flat();
    
    setCalendarEvents(allEvents);
  };

  const handleStreetChange = (street: string) => {
    setFilters(prev => ({ ...prev, street }));
  };

  const handleDateRangeChange = (dateRange: DashboardFilters['dateRange']) => {
    setFilters(prev => ({ ...prev, dateRange }));
  };

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
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
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
              <Badge variant="outline" className="hidden sm:inline-flex">
                Live Data
              </Badge>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 h-full">
          {/* Optimal Opening / Staffing Time Recommendation */}
          <div className="mb-6 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Optimal Opening / Staffing Time</CardTitle>
              </CardHeader>
              <CardContent>
                {statistics && typeof statistics.peakHour === 'number' && (
                  <div className="text-gray-800 dark:text-gray-100">
                    <span>
                      Increased visitor numbers are expected between <b>{getPeakHourRange(statistics.peakHour)}</b>. Consider scheduling additional staff or special offers during this period.
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Dynamic Promotion Timing Recommendation (EN) */}
            {(() => {
              // Use the selected filter start date as reference
              const filterStart = filters.dateRange?.start ? new Date(filters.dateRange.start) : new Date();
              const oneWeek = 7 * 24 * 60 * 60 * 1000;
              const oneMonth = 30 * 24 * 60 * 60 * 1000;
              let nextEvent = null;
              let minDiff = Infinity;
              for (const event of calendarEvents) {
                const diff = new Date(event.date).getTime() - filterStart.getTime();
                if (diff >= 0 && diff < minDiff && (diff < oneWeek || (!nextEvent && diff < oneMonth))) {
                  nextEvent = event;
                  minDiff = diff;
                }
              }
              if (!nextEvent) return null;
              // Format event date (e.g. Friday)
              const eventDate = new Date(nextEvent.date);
              const weekday = eventDate.toLocaleDateString('en-US', { weekday: 'long' });
              // Suggest campaign the day before
              const campaignDate = new Date(eventDate);
              campaignDate.setDate(eventDate.getDate() - 1);
              const campaignWeekday = campaignDate.toLocaleDateString('en-US', { weekday: 'long' });
              // Example impact (static for now)
              const impact = 25;
              return (
                <Card>
                  <CardHeader>
                    <CardTitle>Promotion Timing</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-gray-800 dark:text-gray-100 space-y-2">
                      <div className="pl-2 border-l-2 border-gray-300 dark:border-gray-700">
                        <span className="block">{`On ${weekday}, ${nextEvent.name ? nextEvent.name : 'an event'} takes place, and visitor numbers are expected to increase by `}<b>{impact}%</b>{`. Start your social media campaign on ${campaignWeekday} evening.`}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* Customer Flow Direction Insight */}
            {statistics && typeof statistics.directionRatio === 'number' && (
              <Card>
                <CardHeader>
                  <CardTitle>Customer Flow Direction Insight</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-gray-800 dark:text-gray-100 space-y-2">
                    <div>
                      <span className="italic">Uses Direction Flow</span>
                    </div>
                    <div className="pl-2 border-l-2 border-gray-300 dark:border-gray-700">
                      <span className="block">
                        <b>{Math.round(statistics.directionRatio)}%</b> of pedestrians are moving towards the city center.
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 pl-2 mt-1">
                      {statistics.directionRatio > 60 
                        ? "High inbound traffic – ideal for promotions targeting visitors entering the area."
                        : statistics.directionRatio < 40
                        ? "High outbound traffic – consider positioning offers for people leaving the area."
                        : "Balanced traffic flow in both directions."}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 h-full">
            {/* Sidebar - Filters */}
            <div className="lg:col-span-1">
              <Card className="sticky top-0">
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
                        <span className="font-medium dark:text-gray-200">
                          {loading ? '...' : dailyData.length}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main Content */}
            <div className="lg:col-span-4 space-y-6">
              {/* Statistics Cards */}
              <StatisticsCards
                statistics={statistics}
                loading={loading}
                street={filters.street}
              />

              {/* Charts Section */}
              <div className="space-y-6">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  <div className="xl:col-span-2">
                    <DataVisualization
                      hourlyData={hourlyData}
                      dailyData={dailyData}
                      loading={loading}
                      dateRange={filters.dateRange}
                    />

                    {/* Heatmap placed directly under the data visualization, matching its width */}
                    <div className="mt-4">
                      <HeatmapVisualization
                        hourlyData={hourlyData}
                        loading={loading}
                        street={filters.street}
                        dateRange={filters.dateRange}
                      />
                    </div>
                  </div>
                  
                  <div className="xl:col-span-1">
                    <CalendarComponent
                      events={calendarEvents}
                      loading={loading}
                      dateRange={filters.dateRange}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
