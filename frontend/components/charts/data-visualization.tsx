'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  LabelList,
} from 'recharts';
import { TrendingUp, Clock, Calendar } from 'lucide-react';
import { HourlyDataPoint, DailyDataPoint, DashboardFilters } from '@/lib/types';
import { format } from 'date-fns';
import { calculateDailyPeak, DailyWithPeak } from '@/components/utils/peakhourDay';
import { calculateQuantile } from '@/components/utils/peakperiodDay';

interface DataVisualizationProps {
  hourlyData: HourlyDataPoint[];
  dailyData: DailyDataPoint[];
  loading: boolean;
  dateRange: DashboardFilters['dateRange'];
}

// Helper type for single-day hourly chart
type DailyWithHour = DailyWithPeak & { hour?: number };

export function DataVisualization({
  hourlyData,
  dailyData,
  loading,
  dateRange,
}: DataVisualizationProps) {
  // --- Loading State ---
  if (loading) {
    return (
      <Card className="animate-pulse">
        <CardHeader>
          <div className="h-6 bg-gray-200 rounded w-48"></div>
          <div className="h-4 bg-gray-200 rounded w-64"></div>
        </CardHeader>
        <CardContent>
          <div className="h-96 bg-gray-200 rounded"></div>
        </CardContent>
      </Card>
    );
  }

  // --- No Data State ---
  if (hourlyData.length === 0 && dailyData.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-gray-500">
            <TrendingUp className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>No data available for visualization</p>
            <p className="text-sm mt-2">Try adjusting your filters or date range</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- 1️⃣ Compute Daily Peaks using util ---
  const dailyWithPeaks = calculateDailyPeak(hourlyData, dailyData, dateRange.type);

  type HourlyPeakChartPoint = {
    hour: number;
    total: number;
    peakCount: number;
    isPeak: boolean;
    date?: string;
  };

  let peakChartDataForMultiDay = dailyWithPeaks; // unchanged

  let peakChartDataForSingleDay: HourlyPeakChartPoint[] | null = null;

  if (dateRange.type === 'day' && dailyWithPeaks.length > 0) {
    // Filter to the single day
    const dayRow = dailyWithPeaks[0]; // should be just one day
    const peakHour = dayRow?.peakHour ?? null;
    const peakCount = dayRow?.peakCount ?? 0;
    const theDate = dayRow?.date;

    // Build a lookup by hour if hourly info exists, else fallback
    const hourlyLike = dailyWithPeaks as DailyWithHour[];
    const hourlyByIndex = hourlyLike.reduce<Record<number, DailyWithHour>>((acc, row, idx) => {
      const hourKey = typeof row.hour === 'number' ? row.hour : idx;
      acc[hourKey] = row;
      return acc;
    }, {});

    // Build 0..23 hour points
    peakChartDataForSingleDay = Array.from({ length: 24 }, (_, hour) => {
      const row = hourlyByIndex[hour];
      return {
        hour,
        total: row?.total ?? 0,
        peakCount: hour === peakHour ? peakCount : 0,
        isPeak: hour === peakHour,
        date: theDate,
      };
    });
  }

  // --- 2️⃣ Compute Quantile for highlighting high hours ---
  const hourlyDataForSingleDay = hourlyData.map((d) => ({ ...d }));
  let quantile70 = 0;
  if (dateRange.type === 'day' && hourlyData.length > 0) {
    const totals = hourlyData.map((d) => d.total);
    quantile70 = calculateQuantile(totals, 0.7);
    hourlyDataForSingleDay.forEach((d) => (d.isHigh = d.total >= quantile70));
  }
  const highLineData = hourlyDataForSingleDay.map((d) => ({
    ...d,
    total: d.isHigh ? d.total : null,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <TrendingUp className="h-5 w-5" />
          <span>Pedestrian Flow Analysis</span>
        </CardTitle>
        <div className="flex items-center space-x-4">
          <Badge variant="outline">
            {dateRange.type === 'day' && 'Daily View'}
            {dateRange.type === 'week' && 'Weekly View'}
            {dateRange.type === 'month' && 'Monthly View'}
          </Badge>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {hourlyData.length + dailyData.length} data points
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="hourly" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="hourly" className="flex items-center space-x-2">
              <Clock className="h-4 w-4" />
              <span>Hourly Pattern</span>
            </TabsTrigger>
            <TabsTrigger value="special" className="flex items-center space-x-2">
              <Calendar className="h-4 w-4" />
              <span>Peak Days</span>
            </TabsTrigger>
          </TabsList>

          {/* Hourly Pattern */}
          <TabsContent value="hourly" className="space-y-4">
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                {dateRange.type === 'day' ? (
                  <LineChart data={hourlyDataForSingleDay}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" tickFormatter={(v) => `${v}:00`} />
                    <YAxis />
                    <Tooltip
                      formatter={(value: number) => [value.toLocaleString(), 'Pedestrians']}
                      labelFormatter={(label) =>
                        typeof label === 'number' ? `${label}:00` : String(label)
                      }
                    />
                    <Legend />
                    <Line type="monotone" dataKey="total" stroke="#8884d8" strokeWidth={2} dot={false} />
                    <Line
                      type="monotone"
                      data={highLineData}
                      dataKey="total"
                      stroke="#FF4C4C"
                      strokeWidth={2}
                      dot={false}
                      name="High Traffic Hours"
                    />
                  </LineChart>
                ) : (
                  <AreaChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" tickFormatter={(v) => `${v}:00`} />
                    <YAxis />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        value.toLocaleString(),
                        name === 'total'
                          ? 'Total'
                          : name === 'towards'
                          ? 'Towards City'
                          : 'Away from City',
                      ]}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="towards"
                      stackId="1"
                      stroke="#8884d8"
                      fill="#8884d8"
                      name="Towards City"
                    />
                    <Area
                      type="monotone"
                      dataKey="away"
                      stackId="1"
                      stroke="#82ca9d"
                      fill="#82ca9d"
                      name="Away from City"
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          </TabsContent>

          {/* Peak Days */}
          <TabsContent value="special" className="space-y-4">
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={dateRange.type === 'day' ? peakChartDataForSingleDay ?? [] : peakChartDataForMultiDay}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey={dateRange.type === 'day' ? 'hour' : 'date'}
                    tickFormatter={(value) =>
                      dateRange.type === 'day'
                        ? `${value}:00`
                        : (() => {
                            const d = new Date(String(value));
                            return isNaN(d.getTime()) ? String(value) : format(d, 'MMM dd');
                          })()
                    }
                  />
                  <YAxis />
                  <Tooltip
                    formatter={(value: number, name: string, entry: any) => {
                      if (name === 'peakCount') {
                        const hourLabel =
                          dateRange.type === 'day'
                            ? `${entry?.payload?.hour ?? ''}:00`
                            : `Peak Hour: ${entry?.payload?.peakHour ?? ''}:00`;
                        return [value.toLocaleString(), hourLabel];
                      }
                      return [value.toLocaleString(), name];
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="peakCount"
                    barSize={dateRange.type === 'day' ? 18 : 24}
                    fill="rgba(255, 76, 76, 0.5)"
                    name="Peak Hour Count"
                    radius={[4, 4, 0, 0]}
                  >
                    <LabelList
                      dataKey="peakCount"
                      content={(props) => {
                        const { x, y, width, value } = props;
                        if (!value || value === 0) return null;
                        const textX = x! + width! / 2;
                        const textY = y! - 6;
                        return (
                          <text
                            x={textX}
                            y={textY}
                            fill="#FF0000"
                            fontSize={12}
                            textAnchor="middle"
                          >
                            {value}
                          </text>
                        );
                      }}
                    />
                  </Bar>

                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#3366cc"
                    strokeWidth={2}
                    name="Total Pedestrians"
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
