// useDailyWithPeaks.ts
'use client';

import { useMemo } from 'react';
import { format, isValid } from 'date-fns';
import { HourlyDataPoint, DailyDataPoint } from '@/lib/types';
import { calculateDailyPeak, DailyWithPeak } from '@/components/utils/peakhourDay';

type DateRangeType = { type: 'day' | 'week' | 'month' };

/**
 * Helper to try multiple places for a date value on an hourly point.
 * Returns ISO yyyy-MM-dd or undefined.
 */
function extractDateStringFromHourly(h?: HourlyDataPoint): string | undefined {
  if (!h) return undefined;

  // Try common candidate fields that might exist in different payloads
  const candidates: Array<string | number | Date | undefined> = [
    // common names: timestamp, datetime, date
    // use (h as any) since HourlyDataPoint shape may vary between projects
    (h as any).date,
    (h as any).timestamp,
    (h as any).datetime,
    (h as any).day,
  ];

  for (const c of candidates) {
    if (c == null) continue;
    const d = typeof c === 'string' || typeof c === 'number' ? new Date(c as any) : (c instanceof Date ? c : new Date(String(c)));
    if (isValid(d)) return format(d, 'yyyy-MM-dd');
  }

  return undefined;
}

export function useDailyWithPeaks(
  hourlyData: HourlyDataPoint[],
  dailyData: DailyDataPoint[],
  dateRange: DateRangeType
) {
  return useMemo(() => {
    const dailyWithPeaks: DailyWithPeak[] = calculateDailyPeak(hourlyData, dailyData, dateRange.type) || [];

    const peakChartDataForMultiDay = dailyWithPeaks;

    type HourlyPointOutput = {
      hour: number;
      total: number;
      peakCount: number;
      isPeak: boolean;
      date?: string;
    };

    let peakChartDataForSingleDay: HourlyPointOutput[] | null = null;

    if (dateRange.type === 'day' && dailyWithPeaks.length > 0) {
      const dayRow = dailyWithPeaks[0] as (DailyWithPeak & { hour?: number }) | undefined;
      const peakHour = dayRow?.peakHour ?? null;
      const peakCount = dayRow?.peakCount ?? 0;

      // Determine date string:
      // prefer dayRow.date, else try to guess from first hourlyData entry, else undefined
      let theDate = dayRow?.date;
      if (!theDate) {
        theDate = extractDateStringFromHourly(hourlyData[0]) ?? undefined;
      }

      // Build hour lookup using hourlyData (preferred)
      const hourlyByHour: Record<number, { total?: number } & Partial<DailyWithPeak>> = {};

      if (Array.isArray(hourlyData) && hourlyData.length > 0) {
        hourlyData.forEach((h) => {
          // prefer an explicit 'hour' field on the HourlyDataPoint; else attempt to parse hour from timestamps if available
          const maybeHour = typeof (h as any).hour === 'number' ? (h as any).hour : undefined;
          if (typeof maybeHour === 'number' && maybeHour >= 0 && maybeHour <= 23) {
            hourlyByHour[maybeHour] = { total: h.total };
          } else {
            // fallback: try to parse hour from any timestamp-like field
            const tsCandidate = (h as any).timestamp ?? (h as any).datetime ?? (h as any).date;
            if (tsCandidate != null) {
              const d = new Date(tsCandidate as any);
              if (isValid(d)) {
                const parsedHour = d.getHours();
                hourlyByHour[parsedHour] = { total: h.total };
              }
            }
          }
        });
      }

      // If dailyWithPeaks itself contains per-hour rows (some utils return them), merge them into lookup.
      (dailyWithPeaks as (DailyWithPeak & { hour?: number; total?: number })[]).forEach((r) => {
        if (typeof r.hour === 'number') {
          hourlyByHour[r.hour] = { total: r.total ?? hourlyByHour[r.hour]?.total, ...(r as any) };
        }
      });

      // Build 0..23 array
      peakChartDataForSingleDay = Array.from({ length: 24 }, (_, hour) => {
        const row = hourlyByHour[hour];
        return {
          hour,
          total: row?.total ?? 0,
          peakCount: hour === peakHour ? peakCount : 0,
          isPeak: hour === peakHour,
          date: theDate,
        };
      });
    }

    return {
      dailyWithPeaks,
      peakChartDataForMultiDay,
      peakChartDataForSingleDay,
    };
  }, [hourlyData, dailyData, dateRange.type]);
}
