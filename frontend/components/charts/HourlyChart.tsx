'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  LabelList,
} from 'recharts';
import { DashboardFilters, HourlyDataPoint } from '@/lib/types';
import { DailyWithPeak } from '@/components/utils/peakhourDay';
import { format } from 'date-fns';

interface HourlyChartProps {
  hourlyData: HourlyDataPoint[];
  dailyWithPeaks: DailyWithPeak[];
  dateRange: DashboardFilters['dateRange'];
}

export function HourlyChart({ hourlyData, dailyWithPeaks, dateRange }: HourlyChartProps) {
  const isDaily = dateRange.type === 'day';

  // For "day" view → 24 hourly points (filter to the selected date and fill missing hours)
  const hourlyChartData = isDaily
    ? (() => {
        const targetDate = dateRange && dateRange.start ? format(dateRange.start, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');

        // build map hour -> total (summing if multiple entries exist)
        const map = new Map<number, number>();
        (hourlyData || []).forEach((d: any) => {
          // prefer explicit date/hour fields, else fall back to timestamp
          const dDate = d.date || (d.timestamp ? format(new Date(d.timestamp), 'yyyy-MM-dd') : null);
          if (dDate !== targetDate) return;
          const hour = typeof d.hour === 'number' ? d.hour : new Date(d.timestamp || dDate).getHours();
          const prev = map.get(hour) ?? 0;
          map.set(hour, prev + (Number(d.total ?? 0)));
        });

        const arr: { hour: number; total: number }[] = [];
        for (let h = 0; h < 24; h++) {
          arr.push({ hour: h, total: map.get(h) ?? 0 });
        }

        return arr;
      })()
    : [];

  // For "week/month" → one point per day from dailyWithPeaks
  const dailyChartData = !isDaily
    ? dailyWithPeaks.map((d) => ({
        date: d.date,
        total: d.total,
        peakHour: d.peakHour,
      }))
    : [];

  const chartData = isDaily ? hourlyChartData : dailyChartData;

  return (
    <div className="h-96">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 0, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey={isDaily ? 'hour' : 'date'}
            tickFormatter={(value) =>
              isDaily
                ? `${value}:00`
                : format(new Date(value), 'MMM dd')
            }
          />
          <YAxis />
          <Tooltip />
          <Legend />

          {/* Line for total flow */}
          <Line
            type="monotone"
            dataKey="total"
            stroke="#2563eb"
            strokeWidth={2}
            dot={{ r: 3 }}
            name={isDaily ? 'Pedestrians per Hour' : 'Total Pedestrians per Day'}
          />

          {/* Bar showing peak hour (or highlighting highest point per day) */}
          {!isDaily && (
            <Bar
              dataKey="peakHour"
              barSize={24}
              fill="rgba(255, 99, 132, 0.5)"
              name="Peak Hour"
              radius={[4, 4, 0, 0]}
            >
              <LabelList
                dataKey="peakHour"
                position="top"
                formatter={(hour) => `${hour}:00`}
              />
            </Bar>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
