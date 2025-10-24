'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Clock, Calendar } from 'lucide-react';
import { DashboardFilters, HourlyDataPoint, DailyDataPoint } from '@/lib/types';
import { useDailyWithPeaks } from '@/lib/hooks/useDailyWithPeaks';
import { HourlyChart } from './HourlyChart';
import { PeakDaysChart } from './PeakDaysChart';

interface DataVisualizationProps {
  hourlyData: HourlyDataPoint[];
  dailyData: DailyDataPoint[];
  loading: boolean;
  dateRange: DashboardFilters['dateRange'];
}

export function DataVisualization({
  hourlyData,
  dailyData,
  loading,
  dateRange,
}: DataVisualizationProps) {
  const { dailyWithPeaks } = useDailyWithPeaks(hourlyData, dailyData, dateRange);

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

  if (hourlyData.length === 0 && dailyData.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-gray-500">
          <TrendingUp className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <p>No data available for visualization</p>
          <p className="text-sm mt-2">Try adjusting your filters or date range</p>
        </CardContent>
      </Card>
    );
  }

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

          <TabsContent value="hourly">
            <HourlyChart
              hourlyData={hourlyData}
              dateRange={dateRange}
            />
          </TabsContent>

          <TabsContent value="special">
            <PeakDaysChart
              dailyWithPeaks={dailyWithPeaks}
              dateRange={dateRange}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
