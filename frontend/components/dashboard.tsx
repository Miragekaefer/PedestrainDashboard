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
import { TrendingUp, MapPin } from 'lucide-react';
import { DashboardFilters, StatisticsData, HourlyDataPoint, DailyDataPoint, CalendarEvent, PredictionRecord, StreetTotal, ComparisonSeries } from '@/lib/types';
import { pedestrianAPI } from '@/lib/api';
import { StreetFilter } from './filters/street-filter';
import { DateFilter } from './filters/date-filter';
import { CalendarComponent } from './calendar/calendar-component';
import { DataVisualization } from './charts/data-visualization';
import { HeatmapVisualization } from './charts/heatmap-visualization';
import { StatisticsCards } from './statistics/statistics-cards';
import { ThemeToggle } from './theme-toggle';
import { eachDayOfInterval, format, isAfter, addMonths, subMonths } from 'date-fns';

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
  const [hourlyPredictions, setHourlyPredictions] = useState<HourlyDataPoint[]>([]);
  const [dailyPredictions, setDailyPredictions] = useState<DailyDataPoint[]>([]);
  const [comparisonSeries, setComparisonSeries] = useState<ComparisonSeries[]>([]);
  const [streetTotals, setStreetTotals] = useState<StreetTotal[]>([]);
  const [currentWeather, setCurrentWeather] = useState<{ temperature?: number; condition?: string | string[]; minTemp?: number; maxTemp?: number } | null>(null);
  const [weatherAvailable, setWeatherAvailable] = useState<boolean>(true);
  const [todayPeakHour, setTodayPeakHour] = useState<number | null>(null);
  const [todayTrendAbs, setTodayTrendAbs] = useState<number | null>(null);
  const [todayTrendPct, setTodayTrendPct] = useState<number | null>(null);
  const [lastMonthAvg, setLastMonthAvg] = useState<number | null>(null);


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
  const futureEnd = addMonths(new Date(today), 3);

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
            const eventsInfo: any = await pedestrianAPI.getEventsForDate(dateStr);
            const dateEvents: CalendarEvent[] = [];

            if (eventsInfo && Array.isArray(eventsInfo.events)) {
              eventsInfo.events.forEach((evt: any) => {
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

useEffect(() => {
  if (!dailyData || dailyData.length === 0) return;

  const shiftDates = (data: DailyDataPoint[], days: number): DailyDataPoint[] =>
    data.map(d => ({
      ...d,
      date: new Date(
        new Date(d.date).getTime() + days * 86400000
      ).toISOString().split("T")[0],
    }));

  setComparisonSeries([
    {
      key: "prevDay",
      name: "Vorheriger Tag",
      data: shiftDates(dailyData, -1),
      color: "#06b6d4",
      opacity: 0.35,
    },
    {
      key: "lastWeek",
      name: "Letzte Woche",
      data: shiftDates(dailyData, -7),
      color: "#f59e0b",
      opacity: 0.35,
    },
  ]);
}, [dailyData]);


  // Load data when filters change
useEffect(() => {
  const loadData = async () => {
    if (!filters.street) return;
    if (filters.street === 'All_streets' && streets.length === 0) return; // ✅ wait for street list

    setLoading(true);
    setError(null);

    try {
      const { start, end } = filters.dateRange;
      const startDate = start.toISOString().split('T')[0];
      const endDate = end.toISOString().split('T')[0];

      let combinedData: any[] = [];
      let combinedStats: StatisticsData = {
        totalPedestrians: 0,
        avgHourlyCount: 0,
        peakHour: 0,
        peakCount: 0,
        directionRatio: 0,
        weatherImpact: 'low',
      };

      // ✅ Declare once, always in scope
      let predictionData: any[] = [];

      if (filters.street === 'All_streets') {
        const promises = streets.map(async (street) => {
          try {
            const [hist, stats, pred] = await Promise.all([
              pedestrianAPI.getHistoricalData(street, startDate, endDate),
              pedestrianAPI.getStatistics(street, startDate, endDate),
              pedestrianAPI.getPredictionData(street, startDate, endDate),
            ]);
            return { hist, stats, pred };
          } catch {
            return { hist: null, stats: null, pred: null };
          }
        });

        const results = await Promise.all(promises);

        results.forEach(({ hist, stats, pred }) => {
          if (hist?.data && Array.isArray(hist.data)) {
            combinedData.push(...hist.data);
          }
          if (pred?.predictions && Array.isArray(pred.predictions)) {
            predictionData.push(...pred.predictions);
          }
          if (stats) {
            combinedStats.totalPedestrians += stats.totalPedestrians ?? 0;
            combinedStats.avgHourlyCount += stats.avgHourlyCount ?? 0;
            combinedStats.peakCount = Math.max(combinedStats.peakCount, stats.peakCount ?? 0);
            combinedStats.directionRatio += stats.directionRatio ?? 0;
          }
        });

        if (results.length > 0) {
          combinedStats.avgHourlyCount = Math.round(combinedStats.avgHourlyCount / results.length);
          combinedStats.directionRatio = Math.round(combinedStats.directionRatio / results.length);
        }
      } else {
        // ✅ Single street case
        const [histResp, statsResp, predResp] = await Promise.all([
          pedestrianAPI.getHistoricalData(filters.street, startDate, endDate),
          pedestrianAPI.getStatistics(filters.street, startDate, endDate),
          pedestrianAPI.getPredictionData(filters.street, startDate, endDate),
        ]);

        combinedData = histResp?.data ?? [];
        combinedStats = statsResp ?? combinedStats;
        predictionData = predResp?.predictions ?? [];
      }

      // ✅ Always defined safely
// Transform data
      const hourlyChartData = pedestrianAPI.transformToHourlyData(combinedData ?? []);
      const dailyChartData = pedestrianAPI.transformToDailyData(combinedData ?? []) as DailyDataPoint[];
      const hourlyPredictionData = pedestrianAPI.transformToHourlyData(predictionData ?? []);
      const dailyPredictionData = pedestrianAPI.transformToDailyData(predictionData ?? []);

      // Merge predictions with historical data so predictions fill missing values but actuals take precedence
      const mergeHourly = (preds: HourlyDataPoint[], actuals: HourlyDataPoint[]) => {
        const map = new Map<string, HourlyDataPoint>();
        // insert preds first
        preds.forEach(p => map.set(`${p.date}-${p.hour}`, p));
        // overwrite with actuals where present
        actuals.forEach(a => map.set(`${a.date}-${a.hour}`, a));
        return Array.from(map.values());
      };

      const mergeDaily = (preds: DailyDataPoint[], actuals: DailyDataPoint[]) => {
        const map = new Map<string, DailyDataPoint>();
        preds.forEach(p => map.set(p.date, p));
        actuals.forEach(a => map.set(a.date, a));
        return Array.from(map.values());
      };

      const mergedHourly = mergeHourly(hourlyPredictionData, hourlyChartData);
      const mergedDaily = mergeDaily(dailyPredictionData, dailyChartData);

      // Determine whether weather data (actual or prediction) is available for the selected period
      try {
        let available = false;
        if (filters.dateRange.type === 'month') {
          available = false; // month view intentionally doesn't display weather
        } else if (filters.dateRange.type === 'day') {
          const selectedDateStr = new Date(filters.dateRange.start).toISOString().split('T')[0];
          const hourlyHas = (mergedHourly ?? []).some(h => h.date === selectedDateStr && typeof (h as any).temperature === 'number');
          const dailyHas = (mergedDaily ?? []).some(d => d.date === selectedDateStr && typeof (d as any).temperature === 'number');
          available = hourlyHas || dailyHas;
        } else if (filters.dateRange.type === 'week') {
          const days = eachDayOfInterval({ start: filters.dateRange.start, end: filters.dateRange.end }).map(d => format(d, 'yyyy-MM-dd'));
          for (const day of days) {
            const hourlyHas = (mergedHourly ?? []).some(h => h.date === day && typeof (h as any).temperature === 'number');
            const dailyHas = (mergedDaily ?? []).some(d => d.date === day && typeof (d as any).temperature === 'number');
            if (hourlyHas || dailyHas) { available = true; break; }
          }
        }
        setWeatherAvailable(available);
      } catch (e) {
        setWeatherAvailable(false);
      }

      // Set data
      setHourlyData(hourlyChartData);
      setDailyData(fillDailyData(mergedDaily, filters.dateRange.start, filters.dateRange.end));
      setHourlyPredictions(hourlyPredictionData);
        // Determine representative/current weather only when a single day is selected
        try {
          if (filters.dateRange.type === 'day') {
            const targetDate = startDate; // YYYY-MM-DD from filters
            const dayRecords = dailyChartData.filter(r => r.date === targetDate);
            if (dayRecords && dayRecords.length > 0) {
              // average temperature for the day (if available)
              const avgTemp = dayRecords.reduce((a, b) => a + (b.temperature || 0), 0) / dayRecords.length;
              // most frequent weather condition
              const conds = dayRecords.map(d => d.weather_condition).filter(Boolean) as string[];
              let mode: string | undefined = undefined;
              if (conds.length > 0) {
                const counts: Record<string, number> = {};
                conds.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
                mode = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
              }

              setCurrentWeather({ condition: mode, temperature: dayRecords[0].temperature });
            } else {
              setCurrentWeather(null);
            }
          } else {
            // for week/month selections we don't show specific weather
            setCurrentWeather(null);
          }
        } catch (err) {
          console.warn('Failed to compute current weather:', err);
          setCurrentWeather(null);
        }
      setDailyPredictions(dailyPredictionData);
      setStatistics(combinedStats);
      // compute weather for the selected day (if dateRange.type === 'day') otherwise use today's weather
      try {
        const selectedDate = filters.dateRange.type === 'day' ? new Date(filters.dateRange.start) : new Date();
        const selectedDateStr = selectedDate.toISOString().split('T')[0];

        // If week view: compute weekly range from daily highs (highest temp per day)
        if (filters.dateRange.type === 'week') {
          try {
            const days = eachDayOfInterval({ start: filters.dateRange.start, end: filters.dateRange.end }).map(d => format(d, 'yyyy-MM-dd'));
            const dailyHighs: number[] = [];
            for (const day of days) {
              const dayHourlyTemps = (mergedHourly ?? []).filter(h => h.date === day && typeof (h as any).temperature === 'number').map(h => (h as any).temperature as number);
              if (dayHourlyTemps.length > 0) {
                dailyHighs.push(Math.max(...dayHourlyTemps));
                continue;
              }
              // fallback to daily aggregate temperature if hourly not present
              const matchedDaily = (mergedDaily ?? []).find(d => d.date === day) as any;
              if (matchedDaily && typeof matchedDaily.temperature === 'number') {
                dailyHighs.push(matchedDaily.temperature as number);
              }
            }

            if (dailyHighs.length > 0) {
              const weekMin = Math.min(...dailyHighs);
              const weekMax = Math.max(...dailyHighs);

              // collect weather conditions across the week (prefer hourly, else daily aggregate)
              const condCounts: Record<string, number> = {};
              for (const day of days) {
                const dayHourlyConds = (mergedHourly ?? []).filter(h => h.date === day && h.weather_condition).map(h => h.weather_condition as string);
                if (dayHourlyConds.length > 0) {
                  dayHourlyConds.forEach(c => { condCounts[c] = (condCounts[c] || 0) + 1; });
                } else {
                  const matchedDaily = (mergedDaily ?? []).find(d => d.date === day) as any;
                  if (matchedDaily && matchedDaily.weather_condition) {
                    condCounts[matchedDaily.weather_condition] = (condCounts[matchedDaily.weather_condition] || 0) + 1;
                  }
                }
              }

              let topConditions: string[] | undefined = undefined;
              const condEntries = Object.entries(condCounts);
              if (condEntries.length > 0) {
                condEntries.sort((a, b) => b[1] - a[1]);
                topConditions = condEntries.slice(0, 2).map(c => c[0]);
              }

              setCurrentWeather({ minTemp: Math.round(weekMin), maxTemp: Math.round(weekMax), condition: topConditions });
            } else {
              setCurrentWeather(null);
            }
          } catch (e) {
            setCurrentWeather(null);
          }
        } else {
          // Fallback: prefer aggregated daily data (already computed)
          const matchedDaily = (mergedDaily ?? []).find(d => d.date === selectedDateStr) as any;
          if (matchedDaily && (matchedDaily.temperature !== undefined || matchedDaily.weather_condition !== undefined)) {
            setCurrentWeather({ temperature: matchedDaily.temperature, condition: matchedDaily.weather_condition });
          } else {
            // Fallback2: compute from raw combinedData if available
            const hourlyTemps = (mergedHourly ?? []).filter(h => h.date === selectedDateStr && typeof (h as any).temperature === 'number' && typeof (h as any).hour === 'number' && (h as any).hour >= 10 && (h as any).hour <= 18).map(h => (h as any).temperature as number);
            if (hourlyTemps.length > 0) {
              const min = Math.min(...hourlyTemps);
              const max = Math.max(...hourlyTemps);
              setCurrentWeather({ minTemp: Math.round(min), maxTemp: Math.round(max) });
            } else {
              const temps = (combinedData ?? []).filter(d => d.date === selectedDateStr && typeof d.temperature === 'number').map(d => d.temperature as number);
              if (temps.length > 0) {
                const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
                const conditions = (combinedData ?? []).filter(d => d.date === selectedDateStr && d.weather_condition).map(d => d.weather_condition);
                const condition = conditions.length > 0 ? conditions[0] : undefined;
                setCurrentWeather({ temperature: Math.round(avgTemp), condition });
              } else {
                setCurrentWeather(null);
              }
            }
          }
        }
      } catch (e) {
        setCurrentWeather(null);
      }
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

  // Always compute peak hour recommendation for TODAY (independent of selected date range)
  useEffect(() => {
    const computeTodayPeak = async () => {
      try {
        if (!filters.street) return;
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        // If "All_streets" is selected, aggregate hourly totals across all streets
        if (filters.street === 'All_streets') {
          if (!streets || streets.length === 0) {
            setTodayPeakHour(null);
            return;
          }

          const perStreetPromises = streets.map((st) => Promise.all([
            pedestrianAPI.getHistoricalData(st, todayStr, todayStr),
            pedestrianAPI.getPredictionData(st, todayStr, todayStr),
          ]));

          const results = await Promise.all(perStreetPromises);
          const totalsByHour = new Map<number, number>();

          for (const [histResp, predResp] of results) {
            const hourlyActual = pedestrianAPI.transformToHourlyData(histResp?.data ?? []);
            const hourlyPred = pedestrianAPI.transformToHourlyData(predResp?.predictions ?? []);

            // merge per street, predictions first then overwrite with actuals
            const map = new Map<string, HourlyDataPoint>();
            hourlyPred.forEach(p => map.set(`${p.date}-${p.hour}`, p));
            hourlyActual.forEach(a => map.set(`${a.date}-${a.hour}`, a));
            const merged = Array.from(map.values()).filter(h => h.date === todayStr);

            merged.forEach(h => {
              const hour = (h as any).hour ?? 0;
              const val = (h as any).total ?? 0;
              const prev = totalsByHour.get(hour) ?? 0;
              totalsByHour.set(hour, prev + (typeof val === 'number' ? val : 0));
            });
          }

          if (totalsByHour.size === 0) {
            setTodayPeakHour(null);
            return;
          }

          let peakHourLocal = 0;
          let peakVal = -Infinity;
          for (const [hour, total] of totalsByHour.entries()) {
            if (total > peakVal) {
              peakVal = total;
              peakHourLocal = hour;
            }
          }

          setTodayPeakHour(Number.isFinite(peakVal) ? peakHourLocal : null);
          return;
        }

        // Single street computation
        const [histResp, predResp] = await Promise.all([
          pedestrianAPI.getHistoricalData(filters.street, todayStr, todayStr),
          pedestrianAPI.getPredictionData(filters.street, todayStr, todayStr),
        ]);

        const hourlyActual = pedestrianAPI.transformToHourlyData(histResp?.data ?? []);
        const hourlyPred = pedestrianAPI.transformToHourlyData(predResp?.predictions ?? []);

        // merge: predictions first then overwrite with actuals where present
        const map = new Map<string, HourlyDataPoint>();
        hourlyPred.forEach(p => map.set(`${p.date}-${p.hour}`, p));
        hourlyActual.forEach(a => map.set(`${a.date}-${a.hour}`, a));
        const merged = Array.from(map.values()).filter(h => h.date === todayStr);

        if (merged.length === 0) {
          setTodayPeakHour(null);
          return;
        }

        let peakHourLocal = 0;
        let peakVal = -Infinity;
        merged.forEach(h => {
          const val = (h as any).total ?? 0;
          if (typeof val === 'number' && val > peakVal) {
            peakVal = val;
            peakHourLocal = (h as any).hour ?? 0;
          }
        });

        setTodayPeakHour(Number.isFinite(peakVal) ? peakHourLocal : null);
      } catch (e) {
        setTodayPeakHour(null);
      }
    };

    computeTodayPeak();
  }, [filters.street, streets]);

  // Compute today's trend vs same time on the same weekday last week (absolute and % change)
  useEffect(() => {
    const computeTodayTrend = async () => {
      try {
        if (!filters.street) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const lastWeek = new Date(today);
        lastWeek.setDate(lastWeek.getDate() - 7);

        const todayStr = today.toISOString().split('T')[0];
        const lastStr = lastWeek.toISOString().split('T')[0];
        const now = new Date();
        const currentHour = now.getHours();

        const [histToday, predToday, histLast, predLast] = await Promise.all([
          pedestrianAPI.getHistoricalData(filters.street, todayStr, todayStr),
          pedestrianAPI.getPredictionData(filters.street, todayStr, todayStr),
          pedestrianAPI.getHistoricalData(filters.street, lastStr, lastStr),
          pedestrianAPI.getPredictionData(filters.street, lastStr, lastStr),
        ]);

        // Helper to sum hourly totals up to a given hour for a specific date
        const sumHourlyUpTo = (hourly: any[], dateStr: string, maxHour: number): number | null => {
          const filtered = hourly.filter(h => h.date === dateStr && typeof (h as any).hour === 'number' && (h as any).hour <= maxHour);
          if (filtered.length === 0) return null;
          return filtered.reduce((sum, h: any) => sum + (typeof h.total === 'number' ? h.total : 0), 0);
        };

        // Today's cumulative total up to current hour: prefer predictions, fallback to actuals, then daily total
        const hourlyPredToday = pedestrianAPI.transformToHourlyData(predToday?.predictions ?? []);
        const hourlyActualToday = pedestrianAPI.transformToHourlyData(histToday?.data ?? []);
        let todayCum: number | null = sumHourlyUpTo(hourlyPredToday, todayStr, currentHour);
        if (todayCum === null) todayCum = sumHourlyUpTo(hourlyActualToday, todayStr, currentHour);
        if (todayCum === null) {
          // fallback daily predicted, then daily actual
          const dailyPred = pedestrianAPI.transformToDailyData((predToday?.predictions ?? []) as any);
          const predicted = dailyPred.find(d => d.date === todayStr)?.total;
          if (typeof predicted === 'number') todayCum = predicted;
          if (todayCum === null) {
            const dailyActual = pedestrianAPI.transformToDailyData(histToday?.data ?? []);
            const actual = dailyActual.find(d => d.date === todayStr)?.total;
            if (typeof actual === 'number') todayCum = actual;
          }
        }

        // Last week's cumulative up to same hour: prefer actuals, fallback to predictions, then daily actual
        const hourlyActualLast = pedestrianAPI.transformToHourlyData(histLast?.data ?? []);
        const hourlyPredLast = pedestrianAPI.transformToHourlyData(predLast?.predictions ?? []);
        let lastCum: number | null = sumHourlyUpTo(hourlyActualLast, lastStr, currentHour);
        if (lastCum === null) lastCum = sumHourlyUpTo(hourlyPredLast, lastStr, currentHour);
        if (lastCum === null) {
          const dailyActual = pedestrianAPI.transformToDailyData(histLast?.data ?? []);
          const actual = dailyActual.find(d => d.date === lastStr)?.total;
          if (typeof actual === 'number') lastCum = actual;
          if (lastCum === null) {
            const dailyPred = pedestrianAPI.transformToDailyData((predLast?.predictions ?? []) as any);
            const predicted = dailyPred.find(d => d.date === lastStr)?.total;
            if (typeof predicted === 'number') lastCum = predicted;
          }
        }

        if (todayCum !== null && lastCum !== null && lastCum > 0) {
          const delta = todayCum - lastCum;
          setTodayTrendAbs(Math.round(delta));
          setTodayTrendPct(Math.round((delta / lastCum) * 100));
        } else {
          setTodayTrendAbs(null);
          setTodayTrendPct(null);
        }
      } catch (e) {
        setTodayTrendAbs(null);
        setTodayTrendPct(null);
      }
    };

    computeTodayTrend();
  }, [filters.street]);

  // Compute last month's average daily total for event impact comparison
  useEffect(() => {
    const computeLastMonthAvg = async () => {
      try {
        if (!filters.street) return;
        const today = new Date();
        const oneMonthAgo = new Date(today);
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        
        const startStr = oneMonthAgo.toISOString().split('T')[0];
        const endStr = today.toISOString().split('T')[0];
        
        const histResp = await pedestrianAPI.getHistoricalData(filters.street, startStr, endStr);
        const dailyData = pedestrianAPI.transformToDailyData(histResp?.data ?? []);
        
        if (dailyData.length > 0) {
          const total = dailyData.reduce((sum, d) => sum + (d.total ?? 0), 0);
          setLastMonthAvg(Math.round(total / dailyData.length));
        } else {
          setLastMonthAvg(null);
        }
      } catch {
        setLastMonthAvg(null);
      }
    };
    
    computeLastMonthAvg();
  }, [filters.street]);

  // Calendar events loader: last 6 months to next 3 months
  const loadCalendarEvents = async () => {
    const today = new Date();
    const startWindow = subMonths(new Date(today), 6);
    const endWindow = addMonths(new Date(today), 3);
    const dates: Date[] = [];
    const currentDate = new Date(startWindow);
    currentDate.setHours(0, 0, 0, 0);
    endWindow.setHours(0, 0, 0, 0);
    while (currentDate <= endWindow) {
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
    allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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
      return existing ?? { date, total: 0, avgHourly: 0, weekday: format(new Date(date), 'EEEE'), temperature: undefined, weather_condition: undefined };
    });
  }

  // Next upcoming event (used for recommendations)
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const nextUpcomingEvent = futureEvents.find(ev => new Date(ev.date) >= startOfToday);
  const isEventToday = nextUpcomingEvent ? format(new Date(nextUpcomingEvent.date), 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') : false;

  // Compute next event's influence: % change vs average daily total from last month
  let eventImpactPct: number | null = null;

  if (nextUpcomingEvent && lastMonthAvg !== null && lastMonthAvg > 0) {
    const evDateStr = format(new Date(nextUpcomingEvent.date), 'yyyy-MM-dd');
    // Prefer predictions for future events
    const fromPred = dailyPredictions.find(d => d.date === evDateStr)?.total;
    const fromDaily = dailyData.find(d => d.date === evDateStr)?.total;
    const evTotal = (typeof fromPred === 'number' ? fromPred : (typeof fromDaily === 'number' ? fromDaily : null));

    if (evTotal !== null) {
      const delta = evTotal - lastMonthAvg;
      eventImpactPct = Math.round((delta / lastMonthAvg) * 100);
    }
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
              <Badge variant="outline" className="hidden sm:inline-flex">Live Data</Badge>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 h-full">
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 h-full">
            {/* Full-width Recommendations - compact */}
            <div className="lg:col-span-5">
              <Card className="mb-0">
                <CardHeader className="py-0 pb-0">
                  <CardTitle className="leading-none mb-0">Recommendations</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 pb-0">
                  {!statistics ? (
                    <p className="text-xs leading-none m-0">No recommendations</p>
                  ) : (
                    <div className="flex flex-col gap-1 text-xs leading-none m-0">
                        <span className="font-medium">Peak: <strong>{(todayPeakHour ?? statistics?.peakHour ?? 0)}:00</strong> — <span className="font-normal">consider adapting staffing accordingly</span></span>
                        {todayTrendPct !== null ? (
                          <span className="mt-0">
                            {todayTrendPct > 0
                              ? `Total pedestrians up ${todayTrendPct}% compared to the same time last week.`
                              : todayTrendPct < 0
                                ? `Total pedestrians down ${Math.abs(todayTrendPct)}% compared to the same time last week.`
                                : `Total pedestrians no change (0%) compared to the same time last week.`}
                          </span>
                        ) : null}
                      {nextUpcomingEvent ? (
                        <>
                          <span className="mt-0">{isEventToday ? 'Event:' : 'Next event:'} <strong>{nextUpcomingEvent.name}</strong> on {format(new Date(nextUpcomingEvent.date), 'dd.MM')} — <span className="font-normal">consider adapting operations</span></span>
                          {eventImpactPct !== null ? (
                            <span className="mt-0">Expected impact: {eventImpactPct >= 0 ? `+${eventImpactPct}` : eventImpactPct}% vs last month's avg</span>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
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
                        <span className="font-medium dark:text-gray-200">{loading ? '...' : dailyData.length}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main Content */}
            <div className="lg:col-span-4 space-y-6 h-full overflow-y-auto">
              <StatisticsCards
                statistics={statistics}
                loading={loading}
                street={filters.street}
                currentWeather={currentWeather}
                viewType={filters.dateRange.type}
                weatherAvailable={weatherAvailable}
                dateRange={filters.dateRange}
                hourlyData={hourlyData}
                hourlyPredictions={hourlyPredictions}
                streets={streets}
              />

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2 space-y-6">
                  <DataVisualization
                    hourlyData={hourlyData}
                    dailyData={dailyData}
                    hourlyPredictions={hourlyPredictions}
                    dailyPredictions={dailyPredictions}
                    loading={loading}
                    dateRange={filters.dateRange}
                    comparisonSeries={comparisonSeries}
                    streetTotals={streetTotals}
                    street={filters.street}
                  />
                  
                  <HeatmapVisualization
                    hourlyData={hourlyData}
                    hourlyPredictions={hourlyPredictions}
                    loading={loading}
                    street={filters.street}
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
  );
}
