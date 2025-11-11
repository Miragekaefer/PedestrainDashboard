"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { pedestrianAPI } from '@/lib/api';
import type { HourlyDataPoint, DailyDataPoint } from '@/lib/types';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ComposedChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ReferenceDot,
} from 'recharts';
import { format, parseISO , addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, addYears, subYears } from "date-fns";
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardAction,
} from '@/components/ui/card';

type Props = {
  hourlyData: HourlyDataPoint[];
  dailyData: DailyDataPoint[];
  hourlyPredictions?: HourlyDataPoint[];
  dailyPredictions?: DailyDataPoint[];
  loading?: boolean;
  dateRange?: any;
  // optional advanced props the dashboard can provide:
  streetTotals?: { street: string; total: number }[]; // for pie chart when all streets
  comparisonSeries?: { key: string; name: string; data: any[]; color?: string; opacity?: number }[]; // overlay series
  street?: string;
};

// ---------- Data Builders (unchanged but slightly hardened) ----------
function buildCombinedHourly(actual: HourlyDataPoint[] = [], predicted: HourlyDataPoint[] = []) {
  const map = new Map<string, { date: string; hour: number; actual?: number | null; predicted?: number | null }>();
  const keyFor = (date: string, hour: number) => `${date}__${String(hour).padStart(2, '0')}`;

  (actual || []).forEach((d) => {
    const key = keyFor(d.date, Number(d.hour));
    if (!map.has(key)) map.set(key, { date: d.date, hour: Number(d.hour) });
    const e = map.get(key)!;
    e.actual = (e.actual ?? 0) + Number(d.total ?? 0);
  });

  (predicted || []).forEach((d) => {
    const key = keyFor(d.date, Number(d.hour));
    if (!map.has(key)) map.set(key, { date: d.date, hour: Number(d.hour) });
    const e = map.get(key)!;
    // use null when not present to allow conditional rendering
    e.predicted = (e.predicted ?? 0) + Number(d.total ?? 0);
  });

  return Array.from(map.values())
    .sort((a, b) => (a.date === b.date ? a.hour - b.hour : a.date.localeCompare(b.date)))
    .map((d) => ({
      ...d,
      actual: d.actual ?? 0,
      predicted: d.predicted == null ? null : d.predicted,
    }));
}

function shiftDailySeries(data: DailyDataPoint[], shiftFn: (date: Date) => Date, label: string, key: string) {
  return data.map(d => ({
    date: format(shiftFn(parseISO(d.date)), "yyyy-MM-dd"),
    [key]: d.total,
    name: label,
  }));
}

function buildCombinedDaily(actual: DailyDataPoint[] = [], predicted: DailyDataPoint[] = []) {
  const map = new Map<string, { date: string; actual?: number | null; predicted?: number | null; weekday?: string }>();

  (actual || []).forEach((d) => {
    if (!map.has(d.date)) map.set(d.date, { date: d.date, actual: 0, predicted: null, weekday: d.weekday });
    const e = map.get(d.date)!;
    e.actual = (e.actual ?? 0) + Number(d.total ?? 0);
  });

  (predicted || []).forEach((d) => {
    if (!map.has(d.date)) map.set(d.date, { date: d.date, actual: null, predicted: 0, weekday: d.weekday });
    const e = map.get(d.date)!;
    e.predicted = (e.predicted ?? 0) + Number(d.total ?? 0);
  });

  return Array.from(map.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      actual: d.actual ?? 0,
      predicted: d.predicted == null ? null : d.predicted,
    }));
}

// ---------- Tooltips ----------
const HourlyTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (!p) return null;

  return (
    <div className="bg-white/95 p-3 rounded shadow text-sm text-black border border-gray-200">
      <div className="font-medium mb-2 pb-2 border-b border-gray-200">
        {format(parseISO(p.date), 'PPP')} — {String(p.hour).padStart(2, '0')}:00
      </div>
      {payload.map((item: any, index: number) => {
        const value = item.payload[item.dataKey];
        // Skip if value is null or undefined
        if (value == null) return null;
        return (
          <div key={index} style={{ color: item.stroke || item.fill }} className="flex justify-between gap-4 py-0.5">
            <span className="font-medium">{item.name || item.dataKey}:</span>
            <span className="font-semibold">{value}</span>
          </div>
        );
      })}
    </div>
  );
};

const DailyTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="bg-white/95 p-3 rounded shadow text-sm text-black border border-gray-200">
      <div className="font-medium mb-2 pb-2 border-b border-gray-200">
        {format(parseISO(p.date), 'PPP')} ({p.weekday})
      </div>
      {payload.map((item: any, index: number) => {
        const value = item.payload[item.dataKey];
        // Skip if value is null or undefined
        if (value == null) return null;
        return (
          <div key={index} style={{ color: item.stroke || item.fill }} className="flex justify-between gap-4 py-0.5">
            <span className="font-medium">{item.name || item.dataKey}:</span>
            <span className="font-semibold">{value}</span>
          </div>
        );
      })}
    </div>
  );
};

// ---------- Helpers for Peak Highlighting ----------
function computeDailyAverages(combinedDaily: ReturnType<typeof buildCombinedDaily>) {
  // returns map date -> avgHourly
  const map = new Map<string, number>();
  combinedDaily.forEach((d) => {
    // assume daily total is 'actual' and we divide by 24
    const avg = (d.actual ?? 0) / 24;
    map.set(d.date, avg);
  });
  return map;
}

// Custom dot for line: big colored dot for peak hour / peak point

// ---------- Main Component ----------
export const DataVisualization: React.FC<Props> = ({
  hourlyData,
  dailyData,
  hourlyPredictions = [],
  dailyPredictions = [],
  loading,
  dateRange,
  streetTotals,
  street
}) => {
  const [view, setView] = useState<'hourly' | 'daily' | 'comparison'>('hourly');

  const combinedHourly = useMemo(() => buildCombinedHourly(hourlyData ?? [], hourlyPredictions ?? []), [hourlyData, hourlyPredictions]);
  const combinedDaily = useMemo(() => buildCombinedDaily(dailyData ?? [], dailyPredictions ?? []), [dailyData, dailyPredictions]);

  const dailyAverages = useMemo(() => computeDailyAverages(combinedDaily), [combinedDaily]);

  // When a week is selected in the dateRange, filter the daily series to only the selected days
  const filteredDaily = useMemo(() => {
    // If no dateRange provided, return the combined series as-is
    if (!dateRange || !dateRange.start) return combinedDaily;

    // Determine start/end for the requested range
    const startDate: Date = dateRange.start;
    let endDate: Date;
    if (dateRange.end) endDate = dateRange.end;
    else if (dateRange.type === 'week') endDate = addDays(startDate, 6);
    else endDate = startDate;

    // Build a lookup of existing combinedDaily entries
    const lookup = new Map<string, any>();
    (combinedDaily || []).forEach(d => lookup.set(d.date, d));

    // Build a filled array covering every date in the range. For future dates (after today)
    // set `actual` to null so bars/lines won't render as zero; keep any predicted values if present.
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const out: any[] = [];
    for (let d = new Date(startDate); d.getTime() <= endDate.getTime(); d = addDays(d, 1)) {
      const dateStr = format(d, 'yyyy-MM-dd');
      const existing = lookup.get(dateStr);
      if (existing) {
        // Keep existing record but ensure future actuals are null
        const isFuture = dateStr > todayStr;
        out.push({
          ...existing,
          actual: isFuture ? null : existing.actual ?? 0,
          weekday: existing.weekday ?? format(d, 'EEE'),
        });
      } else {
        const isFuture = dateStr > todayStr;
        out.push({
          date: dateStr,
          actual: isFuture ? null : 0,
          predicted: null,
          weekday: format(d, 'EEE'),
        });
      }
    }

    return out;
  }, [combinedDaily, dateRange]);

  const comparisonSeries = useMemo(() => {
    if (!dailyData || dailyData.length === 0) return [];

    return [
      {
        key: "yesterday",
        name: "Yesterday",
        data: shiftDailySeries(dailyData, (d) => subDays(d, 1), "Yesterday", "yesterday"),
        color: "#ffb6c1",
        opacity: 0.45,
      },
      {
        key: "lastWeek",
        name: "Same Days Last Week",
        data: shiftDailySeries(dailyData, (d) => subWeeks(d, 1), "Last Week", "lastWeek"),
        color: "#0ea5e9",
        opacity: 0.45,
      },
      {
        key: "lastMonth",
        name: "Same Days Last Month",
        data: shiftDailySeries(dailyData, (d) => subMonths(d, 1), "Last Month", "lastMonth"),
        color: "#16a34a",
        opacity: 0.45,
      },
      {
        key: "lastYear",
        name: "Same Days Last Year",
        data: shiftDailySeries(dailyData, (d) => subYears(d, 1), "Last Year", "lastYear"),
        color: "#a855f7",
        opacity: 0.45,
      },
    ];
  }, [dailyData]);
  
  const peakThreshold = useMemo(() => {
    if (!combinedHourly || combinedHourly.length === 0) return 0;
    const values = combinedHourly.map(d => d.actual);
    values.sort((a, b) => a - b);
    const index = Math.floor(values.length * 0.8);
    return values[index];
  }, [combinedHourly]);

  const hourlyDataWithPeaks = useMemo(() => {
    return combinedHourly.map(d => ({
      ...d,
      dateTime: `${d.date}T${String(d.hour).padStart(2, '0')}:00`, // unique key for each hour
      peak: d.actual >= peakThreshold ? d.actual : null, 
    }));
  }, [combinedHourly, peakThreshold]);

  // For hourly view: build an array covering the selected period.
  // If a single day is selected, this will be 24 points (00:00-23:00).
  // If a week is selected, this will cover all hours for the week (7*24 points).
  const hourlyChartForPeriod = useMemo(() => {
    const startDate: Date = dateRange && dateRange.start ? dateRange.start : new Date();
    let endDate: Date;
    if (dateRange && dateRange.end) endDate = dateRange.end;
    else if (dateRange && dateRange.type === 'week') endDate = addDays(startDate, 6);
    else endDate = startDate;

    const arr: any[] = [];
    // iterate days from startDate .. endDate inclusive
    for (let d = new Date(startDate); d.getTime() <= endDate.getTime(); d = addDays(d, 1)) {
      const dateStr = format(d, 'yyyy-MM-dd');
      // build a map of hours for this date for quick lookup
      const map = new Map<number, any>();
      hourlyDataWithPeaks.forEach((h) => {
        if (h.date === dateStr) map.set(h.hour, h);
      });

      for (let h = 0; h < 24; h++) {
        if (map.has(h)) {
          arr.push(map.get(h));
        } else {
          arr.push({
            date: dateStr,
            hour: h,
            actual: 0,
            predicted: null,
            dateTime: `${dateStr}T${String(h).padStart(2, '0')}:00`,
            peak: null,
          });
        }
      }
    }

    return arr;
  }, [hourlyDataWithPeaks, dateRange]);
  
  // Hide actual values from the point where no actual data exists anymore for the day.
  // We determine the last hour that has an actual record from the original `hourlyData` prop
  // (which contains only actual/historical entries). For hours after that, set `actual` to null
  // so the line stops at the last real observation.
  const hourlyChartWithActualsCutoff = useMemo(() => {
    // only apply the per-day cutoff when a single day is selected. For multi-day (week) views
    // keep the hourly entries as-is so the full period is visible.
    // Build a map of last actual hour per date from the provided hourlyData prop
    const lastActualByDate = new Map<string, number>();
    (hourlyData ?? []).forEach(d => {
      const date = d.date;
      const h = Number(d.hour);
      const prev = lastActualByDate.get(date);
      if (prev == null || h > prev) lastActualByDate.set(date, h);
    });

    // If a single day is selected, only return entries for that day with cutoff applied
    if (dateRange && dateRange.type === 'day') {
      const targetDate = dateRange && dateRange.start ? format(dateRange.start, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
      const dayEntries = hourlyChartForPeriod.filter(d => d.date === targetDate);
      const lastActualHour = lastActualByDate.has(targetDate) ? (lastActualByDate.get(targetDate) as number) : -1;

      // If no actuals at all for that day, set actual to null for all hours
      if (lastActualHour === -1) return dayEntries.map(d => ({ ...d, actual: null }));

      return dayEntries.map((d) => {
        if (typeof d.hour !== 'number') return d;
        return {
          ...d,
          actual: d.hour <= lastActualHour ? d.actual : null,
        };
      });
    }

    // For multi-day ranges: apply per-day cutoff using lastActualByDate so each day's line stops where actuals end
    return hourlyChartForPeriod.map(d => {
      const last = lastActualByDate.has(d.date) ? (lastActualByDate.get(d.date) as number) : -1;
      if (last === -1) {
        // no actuals for this date -> null out actuals so line won't draw
        return { ...d, actual: null };
      }
      return { ...d, actual: (typeof d.hour === 'number' && d.hour <= last) ? d.actual : null };
    });
  }, [hourlyChartForPeriod, hourlyData, dateRange]);

  // Determine if there are any actual data points for the displayed day (after cutoff)
  const hasActualsForDisplayedDay = useMemo(() => {
    return hourlyChartWithActualsCutoff.some(d => typeof d.actual === 'number' && d.actual > 0);
  }, [hourlyChartWithActualsCutoff]);

  // Compute top 3 hours by actual count for the displayed day using the cutoff-applied series
  const hourlyChartWithHighlights = useMemo(() => {
    const source = hourlyChartWithActualsCutoff;
    if (!source || source.length === 0) return source;

    // copy and sort to find top 3 (only consider numeric actuals)
    const sorted = [...source].filter(d => typeof d.actual === 'number' && d.actual != null).sort((a, b) => (b.actual ?? 0) - (a.actual ?? 0));
    const top3 = new Set<number>(sorted.slice(0, 3).map(d => d.hour));

    return source.map(d => ({
      ...d,
      highlight: top3.has(d.hour) ? d.actual : null,
    }));
  }, [hourlyChartWithActualsCutoff]);

  // find global peak points for current view (used to mark largest point)
  const globalHourlyPeak = useMemo(() => {
    if (!combinedHourly?.length) return null;
    let best = combinedHourly[0];
    combinedHourly.forEach((d) => {
      if ((d.actual ?? 0) > (best.actual ?? 0)) best = d;
    });
    return best;
  }, [combinedHourly]);

  // X axis ticks: for multi-day views we want to show each date only once (use midnight tick for each date)
  const xAxisTicks = useMemo(() => {
    if (!hourlyChartWithHighlights || hourlyChartWithHighlights.length === 0) return undefined;
    // collect unique dates in order
    const dates = Array.from(new Set(hourlyChartWithHighlights.map(d => d.date)));
    if (dates.length <= 1) return undefined; // single day -> let recharts pick hourly ticks
    // use midday (12:00) so the tick is rendered roughly in the middle of each day
    return dates.map(date => `${date}T12:00`);
  }, [hourlyChartWithHighlights]);


  // Colors for overlay series
  const overlayColors = ['#f97316', '#06b6d4', '#10b981', '#8b5cf6'];

  // Comparison view: which series are active (visible). Keys correspond to dataKey used in the chart.
  const [activeComparisonKeys, setActiveComparisonKeys] = useState<string[]>([]);
  // whether to render comparison as line or bar (for day view)
  const [comparisonChartType, setComparisonChartType] = useState<'line' | 'bar'>('line');

  // Initialize active keys whenever comparisonSeries or dateRange/view change.
  useEffect(() => {
    const base = ['actual'];
    // add predicted to base when we have daily predictions available
    const hasPredicted = (dailyPredictions && dailyPredictions.length > 0) || (combinedDaily && combinedDaily.some(d => d.predicted != null));
    if (hasPredicted) base.push('predicted');
    const seriesKeys = comparisonSeries?.map(s => s.key) ?? [];
    // default: all visible
    setActiveComparisonKeys([...base, ...seriesKeys]);
  }, [comparisonSeries, dateRange, dailyPredictions, combinedDaily]);

  

  // fetched hourly comparison data keyed by date string (YYYY-MM-DD)
  const [fetchedComparisonHourly, setFetchedComparisonHourly] = useState<Record<string, HourlyDataPoint[]>>({});

  // fetched daily comparison totals keyed by date string (YYYY-MM-DD)
  const [fetchedComparisonDaily, setFetchedComparisonDaily] = useState<Record<string, { date: string; actual: number; predicted?: number | null; weekday?: string }>>({});

  // Fetch missing hourly data for comparison dates when needed
  useEffect(() => {
    if (!dateRange || !dateRange.start || !street) return;

    const datesToFetch: string[] = [];
    const target = format(dateRange.start, 'yyyy-MM-dd');
    const candidates = {
      yesterday: format(subDays(dateRange.start, 1), 'yyyy-MM-dd'),
      lastWeek: format(subWeeks(dateRange.start, 1), 'yyyy-MM-dd'),
      lastMonth: format(subMonths(dateRange.start, 1), 'yyyy-MM-dd'),
      lastYear: format(subYears(dateRange.start, 1), 'yyyy-MM-dd'),
    } as Record<string, string>;

    Object.entries(candidates).forEach(([key, dateStr]) => {
      // only consider if checkbox exists and is active
      if (activeComparisonKeys.includes(key) && !fetchedComparisonHourly[dateStr]) {
        datesToFetch.push(dateStr);
      }
    });

    if (datesToFetch.length === 0) return;

    let mounted = true;
    (async () => {
      try {
        const results: Record<string, HourlyDataPoint[]> = {};
        for (const d of datesToFetch) {
          const resp = await pedestrianAPI.getHistoricalData(street, d, d);
          const hourly = pedestrianAPI.transformToHourlyData(resp?.data ?? []);
          results[d] = hourly;
        }
        if (!mounted) return;
        setFetchedComparisonHourly(prev => ({ ...prev, ...results }));
      } catch (e) {
        // ignore fetch errors; leave missing
        console.warn('Failed to fetch comparison hourly data', e);
      }
    })();

    return () => { mounted = false; };
  }, [dateRange, street, activeComparisonKeys, fetchedComparisonHourly]);

  // When a week is selected, prefetch daily totals for the comparison dates that are missing
  useEffect(() => {
    if (!dateRange || !dateRange.start || dateRange.type !== 'week' || !street) return;

    // build a set of dates we need to ensure exist in the daily lookup
    const needed = new Set<string>();

    // for each day in the filtered week, compute the comparison counterpart dates
    (filteredDaily || []).forEach((d) => {
      const dateObj = parseISO(d.date);
      const candidates: Record<string, string> = {
        yesterday: format(subDays(dateObj, 1), 'yyyy-MM-dd'),
        lastWeek: format(subWeeks(dateObj, 1), 'yyyy-MM-dd'),
        lastMonth: format(subMonths(dateObj, 1), 'yyyy-MM-dd'),
        lastYear: format(subYears(dateObj, 1), 'yyyy-MM-dd'),
      };

      Object.entries(candidates).forEach(([key, dateStr]) => {
        // only consider keys that are part of the comparison selection
        if (!activeComparisonKeys.includes(key)) return;
        // skip if we already have this date in combinedDaily or in fetchedComparisonDaily
        const presentInCombined = (combinedDaily || []).some(cd => cd.date === dateStr);
        if (!presentInCombined && !fetchedComparisonDaily[dateStr]) needed.add(dateStr);
      });
    });

    if (needed.size === 0) return;

    let mounted = true;
    (async () => {
      try {
        const results: Record<string, { date: string; actual: number; predicted?: number | null; weekday?: string }> = {};
        for (const dateStr of Array.from(needed)) {
          const resp = await pedestrianAPI.getHistoricalData(street, dateStr, dateStr);
          const hourly = pedestrianAPI.transformToHourlyData(resp?.data ?? []);
          const total = (hourly || []).reduce((s: number, h: any) => s + Number(h.total ?? 0), 0);
          results[dateStr] = { date: dateStr, actual: total, predicted: null, weekday: format(parseISO(dateStr), 'EEE') };
        }
        if (!mounted) return;
        setFetchedComparisonDaily(prev => ({ ...prev, ...results }));
      } catch (e) {
        console.warn('Failed to fetch comparison daily data', e);
      }
    })();

    return () => { mounted = false; };
  }, [dateRange, filteredDaily, activeComparisonKeys, street, combinedDaily, fetchedComparisonDaily]);

  // Build hourly comparison dataset when a single day is selected (use fetchedComparisonHourly when available).
  const combinedComparisonHourlyData = useMemo(() => {
    if (!dateRange || !dateRange.start) return [];
    const targetDate = format(dateRange.start, 'yyyy-MM-dd');

    // helper to get actual from fetchedComparisonHourly first, then fallback to combinedHourly
    const getActualFor = (date: string, hour: number) => {
      const fetched = fetchedComparisonHourly?.[date];
      if (fetched && fetched.length > 0) {
        const f = fetched.find(d => Number(d.hour) === hour);
        return f ? (Number((f as any).total ?? (f as any).total ?? null)) : null;
      }
      const found = combinedHourly.find(d => d.date === date && d.hour === hour);
      return found ? found.actual ?? null : null;
    };

    const yesterday = format(subDays(dateRange.start, 1), 'yyyy-MM-dd');
    const lastWeek = format(subWeeks(dateRange.start, 1), 'yyyy-MM-dd');
    const lastMonth = format(subMonths(dateRange.start, 1), 'yyyy-MM-dd');
    const lastYear = format(subYears(dateRange.start, 1), 'yyyy-MM-dd');

    const arr: any[] = [];
    for (let h = 0; h < 24; h++) {
      const selectedEntry = (hourlyChartWithActualsCutoff || []).find(x => x.hour === h) || null;
      arr.push({
        date: targetDate,
        hour: h,
        dateTime: `${targetDate}T${String(h).padStart(2, '0')}:00`,
        actual: selectedEntry ? (selectedEntry.actual == null ? null : selectedEntry.actual) : null,
        yesterday: getActualFor(yesterday, h),
        lastWeek: getActualFor(lastWeek, h),
        lastMonth: getActualFor(lastMonth, h),
        lastYear: getActualFor(lastYear, h),
      });
    }

    return arr;
  }, [dateRange, combinedHourly, hourlyChartWithActualsCutoff, fetchedComparisonHourly]);

  // For week-mode comparison: merge comparisonSeries daily values into the filteredDaily rows
  const weeklyComparisonDailyData = useMemo(() => {
    if (!filteredDaily || filteredDaily.length === 0) return filteredDaily;

  // Build lookup from combinedDaily for quick access by date, and overlay any fetchedComparisonDaily values
  const lookup = new Map<string, any>();
  (combinedDaily || []).forEach(cd => lookup.set(cd.date, cd));
  Object.entries(fetchedComparisonDaily || {}).forEach(([k, v]) => lookup.set(k, v));

    return filteredDaily.map(d => {
      const row: any = { ...d };
      const dateObj = parseISO(d.date);

      const prevs: Record<string, string> = {
        yesterday: format(subDays(dateObj, 1), 'yyyy-MM-dd'),
        lastWeek: format(subWeeks(dateObj, 1), 'yyyy-MM-dd'),
        lastMonth: format(subMonths(dateObj, 1), 'yyyy-MM-dd'),
        lastYear: format(subYears(dateObj, 1), 'yyyy-MM-dd'),
      };

      Object.entries(prevs).forEach(([key, dateStr]) => {
        const found = lookup.get(dateStr);
        row[key] = found ? (found.actual ?? null) : null;
      });

      return row;
    });
  }, [filteredDaily, combinedDaily]);

  return (
  <Card className="mb-6">
      <CardHeader>
        <CardTitle>Pedestrian Flow</CardTitle>
        <CardAction>
          <div className="flex space-x-2">
            <Button onClick={() => setView('hourly')}>Hourly</Button>
            <Button onClick={() => setView('daily')}>Daily</Button>
            <Button onClick={() => setView('comparison')}>Comparison</Button>
            {/* <Button onClick={() => setView('overview')}>Overview</Button> */}
          </div>
        </CardAction>
      
      </CardHeader>

      <CardContent className="p-0">
        <div className="h-96">
        <AnimatePresence mode="wait">
          {view === 'hourly' ? (
            <motion.div
              key="hourly"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="h-full"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hourlyChartWithHighlights}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="dateTime"
                    // provide explicit ticks for multi-day ranges so each date shows once
                    {...(xAxisTicks ? { ticks: xAxisTicks } : {})}
                    tickFormatter={(dt) => {
                      const date = new Date(dt);
                      // If a single day is selected, only show the hour (HH:00)
                      if (dateRange && dateRange.type === 'day') {
                        return `${String(date.getHours()).padStart(2, '0')}:00`;
                      }
                      // If a week is selected, show weekday and date for each tick (no hour)
                      if (dateRange && dateRange.type === 'week') {
                        return `${format(date, 'EEE dd.MM')}`;
                      }
                      return `${format(date, 'MMM dd')} ${String(date.getHours()).padStart(2, '0')}:00`;
                    }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis />
                  <Legend verticalAlign="bottom" align="center" />

                  {/* Actual line with custom dots marking peaks - only render when actuals exist for the day */}
                  {hasActualsForDisplayedDay && (
                    <Line
                      type="monotone"
                      dataKey="actual"
                      name="Actual"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6 }}
                    />
                  )}

                  {/* Predicted line: only show where predicted isn't null */}
                  {/* Predicted Line */}
                  <Line
                    type="monotone"
                    dataKey="predicted"
                    name="Predicted"
                    stroke="#f59e0b"
                    strokeDasharray="5 5"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 6 }}
                  />

                  {hasActualsForDisplayedDay && dateRange && dateRange.type === 'day' && (
                    <Line
                      type="monotone"
                      dataKey="highlight"
                      name="Top 3 hours"
                      stroke="#dc2626"
                      strokeWidth={4}
                      dot={{ r: 4 }}
                      activeDot={{ r: 8 }}
                      strokeLinecap="round"
                      isAnimationActive={false}
                    />
                  )}
                  <Tooltip content={HourlyTooltip} shared={true} />
                </LineChart>
              </ResponsiveContainer>
            </motion.div>
          ) : view === 'daily' ? (
            <motion.div
              key="daily"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="h-full"
            >
              <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={weeklyComparisonDailyData} barCategoryGap="60%" barGap={16}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={(d) => format(parseISO(d), 'MMM dd')} />
                  <YAxis />
                  <Tooltip content={DailyTooltip} />
                  {dateRange && dateRange.type === 'week' ? (
                    <Legend verticalAlign="bottom" align="center" />
                  ) : (
                    <Legend />
                  )}

                  {/* Main actual bar */}
                  <Bar dataKey="actual" name="Actual" barSize={18} fill="#2563eb" />

                  {/* Predicted overlay as line for clarity */}
                  <Line
                    type="monotone"
                    dataKey="predicted"
                    name="Predicted"
                    stroke="#f59e0b"
                    strokeDasharray="5 5"
                    strokeWidth={3}
                    dot={{ r: 3 }}
                  />

                  {/* comparison series intentionally omitted in the daily view when showing a week selection */}
                </ComposedChart>
              </ResponsiveContainer>
            </motion.div>
          ) : view === 'comparison' ? (
            <motion.div
              key="comparison"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="h-full"
            >
              {/* Comparison view: if comparisonSeries provided, show them overlaid. Else show a message */}
              {comparisonSeries && comparisonSeries.length > 0 ? (
                <>
                  {/* When a single day is selected, allow toggling legend series via checkboxes */}
                  {dateRange && (dateRange.type === 'day' || dateRange.type === 'week') && (
                    <div className="mb-3 ml-4 flex flex-wrap gap-3 items-center">
                      {/* include the 'Selected' actual series */}
                      <label className="inline-flex items-center space-x-2 text-sm">
                        <input
                          type="checkbox"
                          checked={activeComparisonKeys.includes('actual')}
                          onChange={() => {
                            setActiveComparisonKeys(prev => prev.includes('actual') ? prev.filter(k => k !== 'actual') : [...prev, 'actual']);
                          }}
                        />
                        <span style={{ color: '#2563eb' }}>{dateRange.type === 'day' ? 'Selected Day' : 'Selected Week'}</span>
                      </label>

                      {comparisonSeries.map((s, idx) => (
                        <label key={`chk-${s.key}`} className="inline-flex items-center space-x-2 text-sm">
                          <input
                            type="checkbox"
                            checked={activeComparisonKeys.includes(s.key)}
                            onChange={() => {
                              setActiveComparisonKeys(prev => prev.includes(s.key) ? prev.filter(k => k !== s.key) : [...prev, s.key]);
                            }}
                          />
                          <span style={{ color: s.color ?? overlayColors[idx % overlayColors.length] }}>{s.name}</span>
                        </label>
                      ))}

                      {/* Predicted checkbox for week comparison (if available) */}
                      { (dailyPredictions && dailyPredictions.length > 0) || (combinedDaily && combinedDaily.some(d => d.predicted != null)) ? (
                        <label className="inline-flex items-center space-x-2 text-sm">
                          <input
                            type="checkbox"
                            checked={activeComparisonKeys.includes('predicted')}
                            onChange={() => {
                              setActiveComparisonKeys(prev => prev.includes('predicted') ? prev.filter(k => k !== 'predicted') : [...prev, 'predicted']);
                            }}
                          />
                          <span style={{ color: '#f59e0b' }}>Predicted</span>
                        </label>
                      ) : null}

                      {/* Chart type toggle only for single-day hourly comparison */}
                      {dateRange.type === 'day' && (
                        <div className="ml-2 inline-flex items-center space-x-2">
                          <Button size="sm" variant={comparisonChartType === 'bar' ? 'default' : 'ghost'} onClick={() => setComparisonChartType('bar')}>Bar</Button>
                          <Button size="sm" variant={comparisonChartType === 'line' ? 'default' : 'ghost'} onClick={() => setComparisonChartType('line')}>Line</Button>
                        </div>
                      )}
                    </div>
                  )}

                  {dateRange && dateRange.type === 'day' ? (
                    comparisonChartType === 'line' ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={combinedComparisonHourlyData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="dateTime"
                            tickFormatter={(dt) => {
                              const date = new Date(dt);
                              return `${String(date.getHours()).padStart(2, '0')}:00`;
                            }}
                          />
                          <YAxis />
                          <Tooltip content={HourlyTooltip} shared={true} />
                          <Legend />

                          {activeComparisonKeys.includes('actual') && (
                            <Line type="monotone" dataKey="actual" name="Selected Day" stroke="#2563eb" strokeWidth={2} dot={false} />
                          )}

                          {comparisonSeries.map((s, idx) => (
                            activeComparisonKeys.includes(s.key) ? (
                              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? overlayColors[idx % overlayColors.length]} strokeWidth={2} dot={false} />
                            ) : null
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={combinedComparisonHourlyData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="dateTime"
                            tickFormatter={(dt) => {
                              const date = new Date(dt);
                              return `${String(date.getHours()).padStart(2, '0')}:00`;
                            }}
                          />
                          <YAxis />
                          <Tooltip content={HourlyTooltip} shared={true} />
                          <Legend />

                          {activeComparisonKeys.includes('actual') && (
                            <Bar dataKey="actual" name="Selected Day" barSize={12} fill="#2563eb" />
                          )}

                          {comparisonSeries.map((s, idx) => (
                            activeComparisonKeys.includes(s.key) ? (
                              <Bar key={s.key} dataKey={s.key} name={s.name} barSize={8} fill={s.color ?? overlayColors[idx % overlayColors.length]} />
                            ) : null
                          ))}
                        </ComposedChart>
                      </ResponsiveContainer>
                    )
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={weeklyComparisonDailyData} barCategoryGap="20%" barGap={8}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tickFormatter={(d) => format(parseISO(d), 'MMM dd')} />
                        <YAxis />
                        <Tooltip content={DailyTooltip} />
                        <Legend />

                          {activeComparisonKeys.includes('actual') && (
                            <Bar dataKey="actual" name="Selected" barSize={16} fill="#2563eb" />
                          )}

                          {/* Predicted bar for the selected week (toggleable) */}
                          {activeComparisonKeys.includes('predicted') && (
                            <Bar dataKey="predicted" name="Predicted" barSize={12} fill="#f59e0b" opacity={0.9} />
                          )}

                        {comparisonSeries.map((s, idx) => (
                          activeComparisonKeys.includes(s.key) ? (
                            <Bar key={s.key} dataKey={s.key} name={s.name} barSize={10} fill={s.color ?? overlayColors[idx % overlayColors.length]} opacity={s.opacity ?? 0.35} />
                          ) : null
                        ))}
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-gray-500">Keine Vergleichsreihen verfügbar. Übergib `comparisonSeries` an die Komponente (z. B. previousDay, sameDayLastWeek, lastYear).</div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="h-full"
            >

            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </CardContent>
    </Card>
  );
};