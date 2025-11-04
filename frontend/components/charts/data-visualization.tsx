"use client";

import React, { useMemo, useState } from 'react';
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
import { format, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';

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
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="bg-white/95 p-2 rounded shadow text-sm">
      <div className="font-medium">
        {format(parseISO(p.date), 'PPP')} — {String(p.hour).padStart(2, '0')}:00
      </div>
      <div>Actual: {p.actual ?? '—'}</div>
      <div>Predicted: {p.predicted ?? '—'}</div>
    </div>
  );
};

const DailyTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="bg-white/95 p-2 rounded shadow text-sm">
      <div className="font-medium">{format(parseISO(p.date), 'PPP')} ({p.weekday})</div>
      <div>Actual: {p.actual ?? '—'}</div>
      <div>Predicted: {p.predicted ?? '—'}</div>
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
  comparisonSeries = [],
}) => {
  const [view, setView] = useState<'hourly' | 'daily' | 'comparison' | 'overview'>('hourly');

  const combinedHourly = useMemo(() => buildCombinedHourly(hourlyData ?? [], hourlyPredictions ?? []), [hourlyData, hourlyPredictions]);
  const combinedDaily = useMemo(() => buildCombinedDaily(dailyData ?? [], dailyPredictions ?? []), [dailyData, dailyPredictions]);

  const dailyAverages = useMemo(() => computeDailyAverages(combinedDaily), [combinedDaily]);

  const peakThreshold = useMemo(() => {
    if (!combinedHourly || combinedHourly.length === 0) return 0;
    const values = combinedHourly.map(d => d.actual);
    values.sort((a, b) => a - b);
    const index = Math.floor(values.length * 0.8);
    return values[index];
  }, [combinedHourly]);

  const peakLineData = useMemo(() => {
    return combinedHourly.map(d => ({
      ...d,
      peak: d.actual >= peakThreshold ? d.actual : null, 
    }));
  }, [combinedHourly, peakThreshold]);

  // find global peak points for current view (used to mark largest point)
  const globalHourlyPeak = useMemo(() => {
    if (!combinedHourly?.length) return null;
    let best = combinedHourly[0];
    combinedHourly.forEach((d) => {
      if ((d.actual ?? 0) > (best.actual ?? 0)) best = d;
    });
    return best;
  }, [combinedHourly]);

  if (loading) return <div className="h-96 flex items-center justify-center">Loading...</div>;

  // Colors for overlay series
  const overlayColors = ['#f97316', '#06b6d4', '#10b981', '#8b5cf6'];

  return (
    <div className="w-full space-y-4">
      {/* Toggle Buttons */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Pedestrian Flow</h3>
        <div className="flex space-x-2">
          <Button onClick={() => setView('hourly')}>Hourly</Button>
          <Button onClick={() => setView('daily')}>Daily</Button>
          <Button onClick={() => setView('comparison')}>Comparison</Button>
          <Button onClick={() => setView('overview')}>Overview</Button>
        </div>
      </div>

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
                <LineChart data={combinedHourly}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, '0')}:00`} />
                  <YAxis />
                  <Tooltip content={HourlyTooltip} />
                  <Legend />

                  {/* Actual line with custom dots marking peaks */}
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Actual"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false} // normale Punkte entfernen
                  />

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
                  />

                  <Line
                    type="monotone"
                    data={peakLineData}
                    dataKey="peak"
                    stroke="#ef4444"
                    strokeWidth={4}
                    dot={false}
                    isAnimationActive={false}
                  />
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
                <ComposedChart data={combinedDaily}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={(d) => format(parseISO(d), 'MMM dd')} />
                  <YAxis />
                  <Tooltip content={DailyTooltip} />
                  <Legend />

                  {/* Main actual bar */}
                  <Bar dataKey="actual" name="Actual" barSize={24} fill="#2563eb" />

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

                  {/* optional comparison series — provided by dashboard if available */}
                  {comparisonSeries?.map((s, idx) => (
                    <Bar key={s.key} dataKey={s.key} name={s.name} barSize={18} fill={s.color ?? overlayColors[idx % overlayColors.length]} opacity={s.opacity ?? 0.35} />
                  ))}
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
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={combinedDaily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(d) => format(parseISO(d), 'MMM dd')} />
                    <YAxis />
                    <Tooltip />
                    <Legend />

                    <Bar dataKey="actual" name="Selected" barSize={22} fill="#2563eb" />

                    {comparisonSeries.map((s, idx) => (
                      <Bar key={s.key} dataKey={s.key} name={s.name} barSize={14} fill={s.color ?? overlayColors[idx % overlayColors.length]} opacity={s.opacity ?? 0.35} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
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
              {/* Overview: either pie chart for all streets, or stacked small multiples */}
              {streetTotals && streetTotals.length > 0 && (
                <ResponsiveContainer width="100%" height={350}>
                  <PieChart>
                    <Pie
                      data={streetTotals}
                      dataKey="total"
                      nameKey="street"
                      outerRadius={120}
                      label={(entry) => `${entry.street}`}
                    >
                      {streetTotals.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={`hsl(${(index * 40) % 360}, 70%, 60%)`}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>           
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
