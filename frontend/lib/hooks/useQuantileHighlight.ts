'use client';

import { HourlyDataPoint, DashboardFilters } from '@/lib/types';
import { calculateQuantile } from '@/components/utils/peakperiodDay';

// Define local extended types (instead of "extending" the strict base interface)
type HourlyWithFlag = HourlyDataPoint & { isHigh?: boolean };

// Same as HourlyDataPoint, but allow total to be null for Recharts compatibility
type HourlyWithNullableTotal = Omit<HourlyDataPoint, 'total'> & {
  total: number | null;
  isHigh?: boolean;
};

export function useQuantileHighlight(
  hourlyData: HourlyDataPoint[],
  quantile = 0.7,
  dateRange: DashboardFilters['dateRange']
) {
  const highlightedData: HourlyWithFlag[] = hourlyData.map((d) => ({ ...d }));

  let highLineData: HourlyWithNullableTotal[] = [];

  if (dateRange.type === 'day' && highlightedData.length > 0) {
    const totals = highlightedData.map((d) => d.total);
    const q = calculateQuantile(totals, quantile);

    highlightedData.forEach((d) => {
      d.isHigh = typeof d.total === 'number' && d.total >= q;
    });

    // Explicitly cast shape to HourlyWithNullableTotal
    highLineData = highlightedData.map((d) => ({
      ...d,
      total: d.isHigh ? d.total : null,
    })) as HourlyWithNullableTotal[];
  }

  return { highlightedData, highLineData };
}
