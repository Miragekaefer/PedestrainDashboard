import { HourlyDataPoint, DailyDataPoint } from '@/lib/types';
import { format, isValid, parseISO } from 'date-fns';

export interface DailyWithPeak extends DailyDataPoint {
  peakHour?: number;
  peakCount?: number;
}

export function calculateDailyPeak(
  hourlyData: HourlyDataPoint[],
  dailyData: DailyDataPoint[],
  dateRangeType: string
): DailyWithPeak[] {
  // --- SINGLE DAY ---
  if (dateRangeType === 'day' && hourlyData.length > 0) {
    const mapped: DailyWithPeak[] = hourlyData.map((d) => {
      const parsed =
        typeof d.date === 'string' && isValid(parseISO(d.date))
          ? parseISO(d.date)
          : new Date();

      return {
        date: format(parsed, 'yyyy-MM-dd'),
        total: d.total,
        avgHourly: d.total,
        weekday: format(parsed, 'EEEE'),
        peakHour: d.hour,
        peakCount: d.total,
      };
    });

    const peakHourData = mapped.reduce((max, curr) =>
      curr.peakCount! > max.peakCount! ? curr : max
    );

    return mapped.map((d) => ({
      ...d,
      peakHour: peakHourData.peakHour,
      peakCount: peakHourData.peakCount,
    }));
  }

  // --- WEEK / MONTH ---
// --- WEEK / MONTH ---
if ((dateRangeType === 'week' || dateRangeType === 'month') && dailyData.length > 0) {
  const today = new Date();

  // Group hourly data safely by date string
  const hourlyByDate = hourlyData.reduce((acc, d) => {
    // Allow "All" entries in an 'Aggregate' bucket
    if (!d.date || d.date === 'All') {
      if (!acc['Aggregate']) acc['Aggregate'] = [];
      acc['Aggregate'].push(d);
      return acc;
    }

    const parsed = parseISO(d.date);
    if (!isValid(parsed)) {
      console.warn('[calculateDailyPeak] Skipping invalid hourly date entry:', d);
      return acc;
    }

    const dateStr = format(parsed, 'yyyy-MM-dd');
    if (!acc[dateStr]) acc[dateStr] = [];
    acc[dateStr].push(d);
    return acc;
  }, {} as Record<string, HourlyDataPoint[]>);

  
  const mapped = dailyData.map((d) => {
    if (!d.date) return null;

    const parsed = parseISO(d.date);
    if (!isValid(parsed)) return null;

    const dateStr = format(parsed, 'yyyy-MM-dd');
    let hours = hourlyByDate[dateStr];

    // Fallback to Aggregate if per-day entries missing
    if ((!hours || hours.length === 0) && hourlyByDate['Aggregate']) {
      hours = hourlyByDate['Aggregate'];
    }

    if (!hours || hours.length === 0) {
      return { ...d, date: dateStr, peakHour: undefined, peakCount: undefined } as DailyWithPeak;
    }

    const peak = hours.reduce((max, curr) => (curr.total > max.total ? curr : max), hours[0]);

    return {
      ...d,
      date: dateStr,
      peakHour: peak.hour,
      peakCount: peak.total,
    } as DailyWithPeak;
  });

  // --- Clean, two-step filtering to satisfy TS ---
  const nonNull = (mapped.filter((x) => x !== null) as DailyWithPeak[]);

  const final = nonNull.filter((d) => {
    // keep valid dates up to today; if somehow date is not a valid ISO string,
    // we conservatively keep it (this handles Aggregate fallback cases already applied)
    const parsed = parseISO(d.date);
    if (!isValid(parsed)) return true; // keep aggregate/fallback rows
    return parsed <= today;
  });

  return final;
}


  // --- DEFAULT ---
  return dailyData as DailyWithPeak[];
}
