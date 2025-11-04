'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, TrendingUp, Clock, Activity, TrendingDown, Minus } from 'lucide-react';
import { StatisticsData, DashboardFilters, HourlyDataPoint } from '@/lib/types';
import { useState, useEffect, useMemo } from 'react';
import { pedestrianAPI } from '@/lib/api';
import { format, subDays, subYears, isAfter, parseISO, addHours, startOfHour } from 'date-fns';

interface StatisticsCardsProps {
  statistics: StatisticsData | null;
  loading: boolean;
  street: string;
  dateRange?: DashboardFilters['dateRange'];
  hourlyData?: HourlyDataPoint[];
  hourlyPredictions?: HourlyDataPoint[];
  streets?: string[]; // List of all streets for All_streets comparison
}

export function StatisticsCards({ statistics, loading, street, dateRange, hourlyData = [], hourlyPredictions = [], streets = [] }: StatisticsCardsProps) {
  const [lastWeekTotal, setLastWeekTotal] = useState<number | null>(null);
  const [lastYearTotal, setLastYearTotal] = useState<number | null>(null);
  const [loadingComparisons, setLoadingComparisons] = useState(false);
  const [trendHours, setTrendHours] = useState<1 | 3 | 6>(6);
  const [trendMode, setTrendMode] = useState<'now' | 'plan'>('now');
  const [planStartTime, setPlanStartTime] = useState<Date>(() => {
    const d = new Date();
    const mins = d.getMinutes();
    const rounded = Math.round(mins / 15) * 15;
    d.setMinutes(rounded % 60, 0, 0);
    if (rounded >= 60) d.setHours(d.getHours() + 1);
    return d;
  });

  const formatTimeHHMM = (d: Date) => {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const onPlanTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; // HH:mm
    if (!val) return;
    const [hhStr, mmStr] = val.split(':');
    const hh = parseInt(hhStr, 10);
    const mm = parseInt(mmStr, 10);
    const base = new Date();
    base.setHours(isNaN(hh) ? 0 : hh, isNaN(mm) ? 0 : mm, 0, 0);
    // Round to 15 min increments (safety if browser doesn't enforce)
    const mins = base.getMinutes();
    const rounded = Math.round(mins / 15) * 15;
    base.setMinutes(rounded % 60, 0, 0);
    if (rounded >= 60) base.setHours(base.getHours() + 1);
    setPlanStartTime(base);
  };

  // Helper function to format numbers
  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toLocaleString();
  };

  // Calculate total including predictions for current day or week
  const totalWithPredictions = useMemo(() => {
    if (!statistics || !dateRange) {
      return statistics?.totalPedestrians || 0;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const todayStr = format(now, 'yyyy-MM-dd');

    if (dateRange.type === 'day') {
      const selectedDateStr = format(dateRange.start, 'yyyy-MM-dd');
      const selectedDate = parseISO(selectedDateStr);
      const isToday = selectedDateStr === todayStr;
      const isFuture = isAfter(selectedDate, now);

      if (!isToday && !isFuture) {
        // Past date: only show actual data
        return statistics.totalPedestrians;
      }

      // For today or future: sum actual + predictions
      let total = 0;

      // Add actual data (already happened)
      const actualForDate = hourlyData.filter(d => d.date === selectedDateStr);
      actualForDate.forEach(d => {
        if (isToday && d.hour <= currentHour) {
          total += d.total || 0;
        } else if (isFuture) {
          total += d.total || 0;
        }
      });

      // Add predictions for remaining hours
      const predictionsForDate = hourlyPredictions.filter(d => d.date === selectedDateStr);
      predictionsForDate.forEach(d => {
        if (isToday && d.hour > currentHour) {
          total += d.total || 0;
        } else if (isFuture) {
          total += d.total || 0;
        }
      });

      return Math.round(total);
    } else if (dateRange.type === 'week') {
      // For week: sum actual data for past days + (actual + predictions) for today + predictions for future days
      const startDateStr = format(dateRange.start, 'yyyy-MM-dd');
      const endDateStr = format(dateRange.end, 'yyyy-MM-dd');

      let total = 0;

      // Get all dates in the week range
      const startDate = parseISO(startDateStr);
      const endDate = parseISO(endDateStr);
      
      // Process each day in the range
      let currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        const isPast = dateStr < todayStr;
        const isToday = dateStr === todayStr;
        const isFuture = dateStr > todayStr;

        if (isPast) {
          // Past days: only actual data
          const actualForDate = hourlyData.filter(d => d.date === dateStr);
          actualForDate.forEach(d => {
            total += d.total || 0;
          });
        } else if (isToday) {
          // Today: actual data up to current hour + predictions for remaining hours
          const actualForDate = hourlyData.filter(d => d.date === dateStr);
          actualForDate.forEach(d => {
            if (d.hour <= currentHour) {
              total += d.total || 0;
            }
          });

          const predictionsForDate = hourlyPredictions.filter(d => d.date === dateStr);
          predictionsForDate.forEach(d => {
            if (d.hour > currentHour) {
              total += d.total || 0;
            }
          });
        } else if (isFuture) {
          // Future days: only predictions
          const predictionsForDate = hourlyPredictions.filter(d => d.date === dateStr);
          predictionsForDate.forEach(d => {
            total += d.total || 0;
          });
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }

      return Math.round(total);
    }

    // For month or other: just return actual data
    return statistics.totalPedestrians;
  }, [statistics, dateRange, hourlyData, hourlyPredictions]);

  // Calculate peak information based on filter type
  const peakInfo = useMemo(() => {
    if (!statistics || !dateRange) {
      return {
        displayValue: `${statistics?.peakHour || 0}:00`,
        subtitle: `${formatNumber(statistics?.peakCount || 0)} pedestrians`
      };
    }

    if (dateRange.type === 'day') {
      // For day: show peak hour (including predictions for future dates)
      const selectedDateStr = format(dateRange.start, 'yyyy-MM-dd');
      const now = new Date();
      const todayStr = format(now, 'yyyy-MM-dd');
      const currentHour = now.getHours();
      const isFuture = selectedDateStr > todayStr;
      const isToday = selectedDateStr === todayStr;

      // For future dates or today (with predictions), calculate peak hour from data + predictions
      if (isFuture || isToday) {
        const hourlyTotals = new Map<number, number>();

        // Add actual data
        const actualForDate = hourlyData.filter(d => d.date === selectedDateStr);
        actualForDate.forEach(d => {
          if (!isToday || d.hour <= currentHour) {
            const current = hourlyTotals.get(d.hour) || 0;
            hourlyTotals.set(d.hour, current + (d.total || 0));
          }
        });

        // Add predictions
        const predictionsForDate = hourlyPredictions.filter(d => d.date === selectedDateStr);
        predictionsForDate.forEach(d => {
          if (isFuture || (isToday && d.hour > currentHour)) {
            const current = hourlyTotals.get(d.hour) || 0;
            hourlyTotals.set(d.hour, current + (d.total || 0));
          }
        });

        // Find peak hour
        if (hourlyTotals.size > 0) {
          let peakHour = 0;
          let peakCount = 0;
          hourlyTotals.forEach((count, hour) => {
            if (count > peakCount) {
              peakCount = count;
              peakHour = hour;
            }
          });

          return {
            displayValue: `${peakHour}:00`,
            subtitle: `${formatNumber(Math.round(peakCount))} pedestrians`
          };
        }
      }

      // For past dates, use statistics from backend
      return {
        displayValue: `${statistics.peakHour}:00`,
        subtitle: `${formatNumber(statistics.peakCount)} pedestrians`
      };
    } else if (dateRange.type === 'week' || dateRange.type === 'month') {
      // For week/month: find peak day (including predictions for today and future days)
      if (!hourlyData || hourlyData.length === 0) {
        console.log('Peak Day Debug: No hourly data available');
        return {
          displayValue: `${statistics.peakHour}:00`,
          subtitle: `${formatNumber(statistics.peakCount)} pedestrians`
        };
      }

      const now = new Date();
      const currentHour = now.getHours();
      const todayStr = format(now, 'yyyy-MM-dd');
      const startDateStr = format(dateRange.start, 'yyyy-MM-dd');
      const endDateStr = format(dateRange.end, 'yyyy-MM-dd');

      console.log('Peak Day Debug:', {
        dateRangeType: dateRange.type,
        startDateStr,
        endDateStr,
        todayStr,
        hourlyDataLength: hourlyData.length,
        hourlyPredictionsLength: hourlyPredictions.length
      });

      // Group by date and sum totals (including predictions for today and future)
      const dailyTotals = new Map<string, number>();
      
      // Add actual data (only within the selected date range)
      hourlyData.forEach(d => {
        // Check if date is within the selected range
        if (d.date < startDateStr || d.date > endDateStr) {
          return; // Skip dates outside the range
        }

        const isPast = d.date < todayStr;
        const isToday = d.date === todayStr;
        
        if (isPast) {
          // Past days: all actual data
          const current = dailyTotals.get(d.date) || 0;
          dailyTotals.set(d.date, current + (d.total || 0));
        } else if (isToday) {
          // Today: only actual data up to current hour
          if (d.hour <= currentHour) {
            const current = dailyTotals.get(d.date) || 0;
            dailyTotals.set(d.date, current + (d.total || 0));
          }
        }
      });

      // Add predictions for today (remaining hours) and future days (only within the selected date range)
      hourlyPredictions.forEach(d => {
        // Check if date is within the selected range
        if (d.date < startDateStr || d.date > endDateStr) {
          return; // Skip dates outside the range
        }

        const isToday = d.date === todayStr;
        const isFuture = d.date > todayStr;
        
        if (isToday && d.hour > currentHour) {
          // Today: predictions for remaining hours
          const current = dailyTotals.get(d.date) || 0;
          dailyTotals.set(d.date, current + (d.total || 0));
        } else if (isFuture) {
          // Future days: all predictions
          const current = dailyTotals.get(d.date) || 0;
          dailyTotals.set(d.date, current + (d.total || 0));
        }
      });

      // If nothing aggregated (e.g., selected range lies fully beyond prediction horizon),
      // truncate the end of the range to the furthest available date (actuals or predictions)
      if (dailyTotals.size === 0) {
        // Collect furthest dates available within the selected range
        let furthestAvailable: string | null = null;

        const predDates = hourlyPredictions
          .filter(d => d.date >= startDateStr && d.date <= endDateStr)
          .map(d => d.date);
        if (predDates.length > 0) {
          furthestAvailable = predDates.reduce((a, b) => (a > b ? a : b));
        }

        const actualDates = hourlyData
          .filter(d => d.date >= startDateStr && d.date <= endDateStr)
          .map(d => d.date);
        if (actualDates.length > 0) {
          const furthestActual = actualDates.reduce((a, b) => (a > b ? a : b));
          furthestAvailable = furthestAvailable
            ? (furthestActual > furthestAvailable ? furthestActual : furthestAvailable)
            : furthestActual;
        }

        if (furthestAvailable && furthestAvailable >= startDateStr) {
          // Rebuild dailyTotals up to furthestAvailable
          const truncatedEnd = furthestAvailable;
          // Add actuals up to truncated end
          hourlyData.forEach(d => {
            if (d.date < startDateStr || d.date > truncatedEnd) return;
            const isPast = d.date < todayStr;
            const isToday = d.date === todayStr;
            if (isPast) {
              const current = dailyTotals.get(d.date) || 0;
              dailyTotals.set(d.date, current + (d.total || 0));
            } else if (isToday) {
              if (d.hour <= currentHour) {
                const current = dailyTotals.get(d.date) || 0;
                dailyTotals.set(d.date, current + (d.total || 0));
              }
            }
          });

          // Add predictions up to truncated end
          hourlyPredictions.forEach(d => {
            if (d.date < startDateStr || d.date > truncatedEnd) return;
            const isToday = d.date === todayStr;
            const isFuture = d.date > todayStr;
            if (isToday && d.hour > currentHour) {
              const current = dailyTotals.get(d.date) || 0;
              dailyTotals.set(d.date, current + (d.total || 0));
            } else if (isFuture) {
              const current = dailyTotals.get(d.date) || 0;
              dailyTotals.set(d.date, current + (d.total || 0));
            }
          });
        }
      }

      // Find peak day
      let peakDate = '';
      let peakTotal = 0;
      dailyTotals.forEach((total, date) => {
        if (total > peakTotal) {
          peakTotal = total;
          peakDate = date;
        }
      });

      console.log('Peak Day Debug - Results:', {
        dailyTotalsSize: dailyTotals.size,
        dailyTotalsEntries: Array.from(dailyTotals.entries()),
        peakDate,
        peakTotal
      });

      if (peakDate) {
        const date = parseISO(peakDate);
        const formattedDate = format(date, 'MMM dd');
        const weekday = format(date, 'EEEE');
        
        return {
          displayValue: weekday,
          subtitle: `${formattedDate} • ${formatNumber(peakTotal)} pedestrians`
        };
      }

      return {
        displayValue: `${statistics.peakHour}:00`,
        subtitle: `${formatNumber(statistics.peakCount)} pedestrians`
      };
    }

    return {
      displayValue: `${statistics.peakHour}:00`,
      subtitle: `${formatNumber(statistics.peakCount)} pedestrians`
    };
  }, [statistics, dateRange, hourlyData, hourlyPredictions]);

  const peakTitle = useMemo(() => {
    if (!dateRange) return 'Peak Hour';
    if (dateRange.type === 'day') return 'Peak Hour';
    if (dateRange.type === 'week') return 'Peak Day';
    if (dateRange.type === 'month') return 'Peak Day';
    return 'Peak Hour';
  }, [dateRange]);

  // Calculate trend forecast: compare next N hours with last N hours around a precise pivot time
  const trendForecast = useMemo(() => {
    // Helper to combine date (Y-M-D) with time (H:M) from another Date
    const combineDateAndTime = (datePart: Date, timePart: Date) => {
      const d = new Date(datePart);
      d.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
      return d;
    };

    let pivot: Date;
    const now = new Date();
    const isDayMode = dateRange?.type === 'day' && dateRange?.start;
    const isMultiDay = (dateRange?.type === 'week' || dateRange?.type === 'month') && dateRange?.start;
    if (isMultiDay) {
      // Anchor pivot to the selected period's start date (time is irrelevant for day-based windows)
      pivot = dateRange!.start;
    } else if (trendMode === 'now') {
      if (isDayMode) {
        const sel = dateRange!.start;
        const todayStr = format(now, 'yyyy-MM-dd');
        const selStr = format(sel, 'yyyy-MM-dd');
        pivot = selStr === todayStr ? now : combineDateAndTime(sel, now);
      } else {
        pivot = now;
      }
    } else {
      const baseDate = isDayMode ? dateRange!.start : now;
      pivot = combineDateAndTime(baseDate, planStartTime);
    }
  // Hour-based default windows
  let windowPastStart = addHours(pivot, -trendHours);
  let windowPastEnd = pivot;
  let windowFutureStart = pivot;
  let windowFutureEnd = addHours(pivot, trendHours);

    // Build quick lookup maps for performance
    const key = (dateStr: string, hour: number) => `${dateStr}|${hour}`;
    const actMap = new Map<string, number>();
    const predMap = new Map<string, number>();
    for (const d of hourlyData) actMap.set(key(d.date, d.hour), d.total || 0);
    for (const d of hourlyPredictions) predMap.set(key(d.date, d.hour), d.total || 0);

    const getValue = (dateStr: string, hour: number, preferPred: boolean) => {
      const k = key(dateStr, hour);
      const act = actMap.get(k);
      const pred = predMap.get(k);
      if (preferPred) return (pred ?? act ?? 0);
      return (act ?? pred ?? 0);
    };

    const toBucketStart = (dateStr: string, hour: number) => {
      const hh = String(hour).padStart(2, '0');
      // Construct local time Date
      return new Date(`${dateStr}T${hh}:00:00`);
    };

    const sumWindowHours = (start: Date, end: Date, preferPred: boolean) => {
      if (end <= start) return 0;
      let total = 0;
      let cursor = startOfHour(start);
      // Iterate over hour buckets overlapping [start, end)
      for (let i = 0; i < 48; i++) { // safety cap
        const bucketStart = cursor;
        const bucketEnd = addHours(bucketStart, 1);
        if (bucketStart >= end) break;
        const overlapStart = new Date(Math.max(bucketStart.getTime(), start.getTime()));
        const overlapEnd = new Date(Math.min(bucketEnd.getTime(), end.getTime()));
        const overlapMs = Math.max(0, overlapEnd.getTime() - overlapStart.getTime());
        if (overlapMs > 0) {
          const dateStr = format(bucketStart, 'yyyy-MM-dd');
          const hour = bucketStart.getHours();
          const value = getValue(dateStr, hour, preferPred);
          const fraction = overlapMs / (60 * 60 * 1000);
          total += value * fraction;
        }
        cursor = bucketEnd;
      }
      return total;
    };

    // If week mode, switch to day-based windows (full day sums)
  const isMulti = dateRange?.type === 'week' || dateRange?.type === 'month';
    const dayListBetween = (startDate: Date, days: number, direction: 1 | -1) => {
      const arr: string[] = [];
      let d = new Date(startDate);
      for (let i = 0; i < days; i++) {
        arr.push(format(d, 'yyyy-MM-dd'));
        d.setDate(d.getDate() + direction);
      }
      return arr;
    };

    const sumDays = (dates: string[], preferPred: boolean) => {
      let total = 0;
      for (const dateStr of dates) {
        // sum 24 hours for the day
        for (let h = 0; h < 24; h++) {
          total += getValue(dateStr, h, preferPred);
        }
      }
      return total;
    };

    let pastTotal: number;
    let futureTotal: number;
    let lastAvg: number;
    let nextAvg: number;
    let subline: string;

  if (isMulti) {
      // Align pivot to start of its day for day windows
      const pivotDayStart = new Date(pivot);
      pivotDayStart.setHours(0, 0, 0, 0);
      // Past days: strictly previous N full days
      const pastDays = dayListBetween(new Date(pivotDayStart.getTime() - 24*60*60*1000), trendHours, -1).reverse();
      // Future days: starting with pivot day inclusive for forecasts
      const futureDays = dayListBetween(pivotDayStart, trendHours, 1);

      pastTotal = sumDays(pastDays, false);
      futureTotal = sumDays(futureDays, true);
      lastAvg = pastTotal / trendHours;
      nextAvg = futureTotal / trendHours;

  const unit = trendHours === 1 ? 'day' : 'days';
  const rangeStart = futureDays[0];
  const rangeEnd = futureDays[futureDays.length - 1];
  subline = `vs last ${trendHours}${unit === 'days' ? 'd' : 'd'} • ${rangeStart}–${rangeEnd}`;
    } else {
      pastTotal = sumWindowHours(windowPastStart, windowPastEnd, false);
      futureTotal = sumWindowHours(windowFutureStart, windowFutureEnd, true);
      lastAvg = pastTotal / trendHours;
      nextAvg = futureTotal / trendHours;

      const hourText = trendHours === 1 ? 'hour' : 'hours';
      const nextStartStr = format(windowFutureStart, 'HH:mm');
      const nextEndStr = format(windowFutureEnd, 'HH:mm');
      subline = `vs last ${trendHours}${hourText === 'hours' ? 'h' : 'h'} • ${nextStartStr}–${nextEndStr}`;
    }

    if (!isFinite(lastAvg) || lastAvg === 0) {
      return {
        status: 'neutral',
        percentage: 0,
        text: 'No comparison data available'
      } as const;
    }

    const percentageChange = ((nextAvg - lastAvg) / lastAvg) * 100;

    let status: 'increase' | 'decrease' | 'stable';
    let icon: typeof TrendingUp;
    let color: string;

    if (percentageChange > 10) {
      status = 'increase';
      icon = TrendingUp;
  color = 'text-green-500 dark:text-green-400';
    } else if (percentageChange < -10) {
      status = 'decrease';
      icon = TrendingDown;
  color = 'text-red-500 dark:text-red-400';
    } else {
      status = 'stable';
      icon = Minus;
      color = 'text-yellow-600 dark:text-yellow-400';
    }

    // Determine confidence based on prediction coverage in future window
    const hoursCovered: Array<{ dateStr: string; hour: number; hasPred: boolean; overlaps: boolean }>=[];
    let cursor = startOfHour(windowFutureStart);
    for (let i = 0; i < 48; i++) {
      const bucketStart = cursor;
      const bucketEnd = addHours(bucketStart, 1);
      if (bucketStart >= windowFutureEnd) break;
      const overlapStart = new Date(Math.max(bucketStart.getTime(), windowFutureStart.getTime()));
      const overlapEnd = new Date(Math.min(bucketEnd.getTime(), windowFutureEnd.getTime()));
      const overlaps = overlapEnd > overlapStart;
      const dateStr = format(bucketStart, 'yyyy-MM-dd');
      const hour = bucketStart.getHours();
      const hasPred = predMap.has(key(dateStr, hour));
      hoursCovered.push({ dateStr, hour, hasPred, overlaps });
      cursor = bucketEnd;
    }
    const overlapped = hoursCovered.filter(h => h.overlaps);
    const covered = overlapped.filter(h => h.hasPred).length;
    const coverage = overlapped.length ? covered / overlapped.length : 0;
    const confidence = coverage >= 0.8 ? 'high' : coverage >= 0.4 ? 'medium' : 'low';

    // Build display strings
  const approx = (n: number) => Math.round(n);
  const diff = approx(futureTotal) - approx(pastTotal);
  const diffSign = diff > 0 ? '+' : '';

    return {
      status,
      percentage: percentageChange,
      subline,
      confidence,
      icon,
      color
    };
  }, [hourlyData, hourlyPredictions, trendHours, trendMode, planStartTime, dateRange]);

  // Load comparison data based on filter type
  useEffect(() => {
    if (!dateRange || !statistics) {
      setLastWeekTotal(null);
      setLastYearTotal(null);
      return;
    }

    const loadComparisonData = async () => {
      setLoadingComparisons(true);
      try {
        let previousPeriodStart: Date;
        let previousPeriodEnd: Date;
        let lastYearStart: Date;
        let lastYearEnd: Date;

        const startDate = dateRange.start;
        const endDate = dateRange.end;

        if (dateRange.type === 'day') {
          // Previous day: 7 days ago
          previousPeriodStart = subDays(startDate, 7);
          previousPeriodEnd = subDays(endDate, 7);
          // Last year: same day last year
          lastYearStart = subYears(startDate, 1);
          lastYearEnd = subYears(endDate, 1);
        } else if (dateRange.type === 'week') {
          // Previous week: 7 days earlier
          previousPeriodStart = subDays(startDate, 7);
          previousPeriodEnd = subDays(endDate, 7);
          // Last year: same week last year
          lastYearStart = subYears(startDate, 1);
          lastYearEnd = subYears(endDate, 1);
        } else if (dateRange.type === 'month') {
          // Previous month: subtract 1 month
          previousPeriodStart = new Date(startDate);
          previousPeriodStart.setMonth(previousPeriodStart.getMonth() - 1);
          previousPeriodEnd = new Date(endDate);
          previousPeriodEnd.setMonth(previousPeriodEnd.getMonth() - 1);
          // Last year: same month last year
          lastYearStart = subYears(startDate, 1);
          lastYearEnd = subYears(endDate, 1);
        } else {
          return;
        }

        const prevStartStr = format(previousPeriodStart, 'yyyy-MM-dd');
        const prevEndStr = format(previousPeriodEnd, 'yyyy-MM-dd');
        const lastYearStartStr = format(lastYearStart, 'yyyy-MM-dd');
        const lastYearEndStr = format(lastYearEnd, 'yyyy-MM-dd');

        if (street === 'All_streets') {
          // For All_streets: aggregate data from all streets
          const streetsToQuery = streets.length > 0 ? streets : [];
          
          if (streetsToQuery.length === 0) {
            setLastWeekTotal(null);
            setLastYearTotal(null);
            return;
          }

          const [previousResults, lastYearResults] = await Promise.all([
            Promise.all(streetsToQuery.map(s => 
              pedestrianAPI.getHistoricalData(s, prevStartStr, prevEndStr).catch(() => ({ data: [] }))
            )),
            Promise.all(streetsToQuery.map(s => 
              pedestrianAPI.getHistoricalData(s, lastYearStartStr, lastYearEndStr).catch(() => ({ data: [] }))
            ))
          ]);

          const previousSum = previousResults.reduce((total, response) => {
            return total + (response.data?.reduce((sum, d) => sum + (d.n_pedestrians || 0), 0) || 0);
          }, 0);

          const lastYearSum = lastYearResults.reduce((total, response) => {
            return total + (response.data?.reduce((sum, d) => sum + (d.n_pedestrians || 0), 0) || 0);
          }, 0);

          setLastWeekTotal(previousSum);
          setLastYearTotal(lastYearSum);
        } else {
          // For single street
          const [previousPeriodData, lastYearData] = await Promise.all([
            pedestrianAPI.getHistoricalData(street, prevStartStr, prevEndStr),
            pedestrianAPI.getHistoricalData(street, lastYearStartStr, lastYearEndStr),
          ]);

          const previousSum = previousPeriodData.data?.reduce((sum, d) => sum + (d.n_pedestrians || 0), 0) || 0;
          const lastYearSum = lastYearData.data?.reduce((sum, d) => sum + (d.n_pedestrians || 0), 0) || 0;

          setLastWeekTotal(previousSum);
          setLastYearTotal(lastYearSum);
        }
      } catch (error) {
        console.error('Failed to load comparison data:', error);
        setLastWeekTotal(null);
        setLastYearTotal(null);
      } finally {
        setLoadingComparisons(false);
      }
    };

    loadComparisonData();
  }, [dateRange, street, statistics]);
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 bg-gray-200 rounded w-24"></div>
              <div className="h-4 w-4 bg-gray-200 rounded"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-gray-200 rounded w-16 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-32"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!statistics) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-gray-500">
            <p>No data available for the selected period</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getWeatherImpactColor = (impact: string) => {
    switch (impact) {
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      default: return 'outline';
    }
  };

  const getWeatherImpactText = (impact: string) => {
    switch (impact) {
      case 'high': return 'High Impact';
      case 'medium': return 'Medium Impact';
      default: return 'Low Impact';
    }
  };

  const calculatePercentageChange = (current: number, previous: number | null) => {
    if (previous === null || previous === 0) return null;
    const change = ((current - previous) / previous) * 100;
    return change;
  };

  // Show comparisons only for day and week filters, not for month (now also for All_streets)
  const showComparison = dateRange && dateRange.type !== 'month' && !loadingComparisons;

  const getComparisonLabels = () => {
    if (!dateRange) return { previous: '', lastYear: '' };
    
    switch (dateRange.type) {
      case 'day':
        return { previous: 'Last week:', lastYear: 'Last year:' };
      case 'week':
        return { previous: 'Previous week:', lastYear: 'Last year:' };
      case 'month':
        return { previous: 'Previous month:', lastYear: 'Last year:' };
      default:
        return { previous: '', lastYear: '' };
    }
  };

  const comparisonLabels = getComparisonLabels();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {/* Total Pedestrians */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Pedestrians</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatNumber(totalWithPredictions)}</div>
          <p className="text-xs text-muted-foreground">
            {street} • {statistics.avgHourlyCount} avg/hour
          </p>
          
          {/* Show comparisons for day/week/month filters */}
          {showComparison && (lastWeekTotal !== null || lastYearTotal !== null) && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-1">
              {lastWeekTotal !== null && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{comparisonLabels.previous}</span>
                  <span className="font-medium">
                    {formatNumber(lastWeekTotal)}
                    {(() => {
                      const change = calculatePercentageChange(totalWithPredictions, lastWeekTotal);
                      if (change !== null) {
                        const isPositive = change > 0;
                        return (
                          <span className={`ml-1 ${isPositive ? 'text-green-500 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                            ({isPositive ? '+' : ''}{change.toFixed(1)}%)
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </span>
                </div>
              )}
              {lastYearTotal !== null && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{comparisonLabels.lastYear}</span>
                  <span className="font-medium">
                    {formatNumber(lastYearTotal)}
                    {(() => {
                      const change = calculatePercentageChange(totalWithPredictions, lastYearTotal);
                      if (change !== null) {
                        const isPositive = change > 0;
                        return (
                          <span className={`ml-1 ${isPositive ? 'text-green-500 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                            ({isPositive ? '+' : ''}{change.toFixed(1)}%)
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Peak Hour */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{peakTitle}</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {peakInfo.displayValue}
          </div>
          <p className="text-xs text-muted-foreground">
            {peakInfo.subtitle}
          </p>
        </CardContent>
      </Card>

      {/* Trend Forecast */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Trend Forecast</CardTitle>
          {trendForecast.icon && <trendForecast.icon className={`h-4 w-4 ${trendForecast.color}`} />}
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {/* Mode Switch only for day mode */}
            {dateRange?.type === 'day' && (
              <>
                <div className="flex gap-1">
                  <button
                    onClick={() => setTrendMode('now')}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      trendMode === 'now'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    Now
                  </button>
                  <button
                    onClick={() => setTrendMode('plan')}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      trendMode === 'plan'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    Plan
                  </button>
                </div>
                <div className="h-4 w-px bg-border" />
              </>
            )}
            {/* Presets */}
            <div className="flex gap-1">
              <button
                onClick={() => setTrendHours(1)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  trendHours === 1
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80'
                }`}
              >
                {dateRange?.type === 'week' || dateRange?.type === 'month' ? '1d' : '1h'}
              </button>
              <button
                onClick={() => setTrendHours(3)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  trendHours === 3
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80'
                }`}
              >
                {dateRange?.type === 'week' || dateRange?.type === 'month' ? '3d' : '3h'}
              </button>
              <button
                onClick={() => setTrendHours(6)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  trendHours === 6
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80'
                }`}
              >
                {dateRange?.type === 'week' || dateRange?.type === 'month' ? '6d' : '6h'}
              </button>
            </div>
            {/* Start time for Plan */}
            {dateRange?.type === 'day' && trendMode === 'plan' && (
              <>
                <div className="h-4 w-px bg-border" />
                <input
                  type="time"
                  step={900}
                  value={formatTimeHHMM(planStartTime)}
                  onChange={onPlanTimeChange}
                  className="text-xs px-2 py-1 rounded border bg-background"
                />
              </>
            )}
          </div>
          {/* Kernzeile */}
          <div className={`text-2xl font-bold ${trendForecast.color}`}>
            {trendForecast.percentage > 0 ? '↑ ' : trendForecast.percentage < 0 ? '↓ ' : '→ '}
            {trendForecast.percentage > 0 ? '+' : ''}{Math.round(trendForecast.percentage)}%
          </div>
          {/* Subline */}
          <p className="text-xs text-muted-foreground mt-1">
            {trendForecast.subline}
          </p>
          
        </CardContent>
      </Card>

      {/* Weather Impact */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Weather Impact</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <Badge variant={getWeatherImpactColor(statistics.weatherImpact)} className="mb-2">
            {getWeatherImpactText(statistics.weatherImpact)}
          </Badge>
          <p className="text-xs text-muted-foreground">
            on pedestrian count
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
