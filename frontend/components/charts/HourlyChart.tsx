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

  // For "day" view → 24 hourly points
  const hourlyChartData = isDaily
    ? hourlyData.map((d: any) => ({
        hour: d.hour ?? new Date(d.timestamp || d.date).getHours(),
        total: d.total,
      }))
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
