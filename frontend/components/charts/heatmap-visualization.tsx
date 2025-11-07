'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HourlyDataPoint } from '@/lib/types';
import { useState, useEffect } from 'react';

interface HeatmapData {
  day: number;      // 0-6 for Sunday-Saturday
  hour: number;     // 0-23
  value: number;    // Average pedestrian count
}


import { DashboardFilters } from '@/lib/types';
import { format, addDays, eachDayOfInterval } from 'date-fns';

interface HeatmapVisualizationProps {
  hourlyData: HourlyDataPoint[];
  hourlyPredictions?: HourlyDataPoint[];
  loading: boolean;
  street: string;
  dateRange?: DashboardFilters['dateRange'];
}

export function HeatmapVisualization({ hourlyData, hourlyPredictions = [], loading, street, dateRange }: HeatmapVisualizationProps) {
  const [heatmapData, setHeatmapData] = useState<HeatmapData[]>([]);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Determine which days to show based on dateRange
  let daysToShow: number[] = Array.from({ length: 7 }, (_, i) => i);
  let dayLabels: string[] = days;
  let dateStrings: string[] = [];
  
  if (dateRange && dateRange.type === 'day') {
    // Show only the selected day
    const selectedDate = dateRange.start;
    const selectedDay = selectedDate.getDay();
    daysToShow = [selectedDay];
    dayLabels = [format(selectedDate, 'EEE, d MMM')]; // Show date
    dateStrings = [format(selectedDate, 'yyyy-MM-dd')];
  } else if (dateRange && dateRange.type === 'week') {
    // Show week starting from the selected start date
    const weekDays = eachDayOfInterval({
      start: dateRange.start,
      end: dateRange.end
    });
    daysToShow = weekDays.map(d => d.getDay());
    dayLabels = weekDays.map(d => format(d, 'EEE, d MMM')); // Show date with day name
    dateStrings = weekDays.map(d => format(d, 'yyyy-MM-dd'));
  }

  // Process data when hourlyData or predictions change
  useEffect(() => {
    if (!hourlyData.length && !hourlyPredictions.length) return;

    // Map date strings to day indices for filtering
    const dateToDay = new Map<string, number>();
    if (dateStrings.length > 0) {
      dateStrings.forEach((dateStr, idx) => {
        dateToDay.set(dateStr, daysToShow[idx]);
      });
    }

    // Initialize accumulator for sum and count for each day-hour combination
    const accumulator: Record<string, { sum: number; count: number }> = {};

    // Initialize all possible day-hour combinations with 0
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const key = `${day}-${hour}`;
        accumulator[key] = { sum: 0, count: 0 };
      }
    }

    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const currentHour = now.getHours();

    // Aggregate actual data by day and hour
    hourlyData.forEach(entry => {
      const dateStr = entry.date;
      let day: number;
      
      // If we have specific date filtering (day or week mode), use that
      if (dateToDay.size > 0) {
        if (!dateToDay.has(dateStr)) return; // Skip dates not in our range
        day = dateToDay.get(dateStr)!;
      } else {
        const date = new Date(dateStr);
        day = date.getDay(); // 0-6
      }
      
      const hour = entry.hour;
      const key = `${day}-${hour}`;

      accumulator[key].sum += entry.total;
      accumulator[key].count += 1;
    });

    // Aggregate predictions for future hours/days
    hourlyPredictions.forEach(entry => {
      const dateStr = entry.date;
      const isToday = dateStr === todayStr;
      const isFuture = dateStr > todayStr || (isToday && entry.hour > currentHour);

      if (!isFuture) return; // Only use predictions for future

      let day: number;
      
      // If we have specific date filtering (day or week mode), use that
      if (dateToDay.size > 0) {
        if (!dateToDay.has(dateStr)) return; // Skip dates not in our range
        day = dateToDay.get(dateStr)!;
      } else {
        const date = new Date(dateStr);
        day = date.getDay(); // 0-6
      }
      
      const hour = entry.hour;
      const key = `${day}-${hour}`;

      accumulator[key].sum += entry.total;
      accumulator[key].count += 1;
    });

    // Convert to array format and calculate averages
    const processedData: HeatmapData[] = Object.entries(accumulator).map(([key, value]) => {
      const [day, hour] = key.split('-').map(Number);
      const avg = value.count > 0 ? value.sum / value.count : 0;
      return {
        day,
        hour,
        value: Number.isFinite(avg) ? avg : 0,
      };
    });

    console.log('Processed heatmap data:', processedData);
    setHeatmapData(processedData);
  }, [hourlyData, hourlyPredictions, dateRange]);

  // Find max value for color scaling
    const maxValue = Math.max(...heatmapData.map(d => d.value)) || 1; // Prevent division by zero  // Color scale function with 5 distinct levels
  const colorSteps = [
    'rgba(255,0,0,0.00)', // 1: sehr transparent
    'rgba(255, 0, 0, 0.1)', // 2: etwas kräftiger
    'rgba(255, 0, 0, 0.2)', // 3: rot
    'rgba(255, 0, 0, 0.3)', // 4: rot
    'rgba(255, 0, 0, 0.5)', // 5: rot
    'rgba(255, 0, 0, 0.75)', // 6: kräftiges rot
    'rgba(255, 0, 0, 0.9)',            // 7: orange
    '#f95317ec',            // 8: dunkler orange
    '#fd8a06ff',            // 9: gelb
    '#e9c614ff'             // 10: kräftiges gelb
  ];


  // Verbesserte Legende: sinnvolle Intervallgrenzen
  const allValues = heatmapData.map(d => d.value).filter(v => Number.isFinite(v) && v > 0);
  const minValue = allValues.length > 0 ? Math.min(...allValues) : 0;
  const maxValueLegend = allValues.length > 0 ? Math.max(...allValues) : 1;

  // Dynamische sinnvolle Intervallgrenzen (z.B. 0, 1, 5, 10, 20, 50, 100, ...)
  function getNiceIntervals(min: number, max: number, steps: number) {
    if (max <= 1) return Array.from({ length: steps + 1 }, (_, i) => i);
    const niceSteps = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    // Finde die passenden Grenzen für den Wertebereich
    const filtered = niceSteps.filter(v => v >= min && v <= max);
    // Immer 0 als Start, max als Ende
    let result = [0, ...filtered];
    if (result[result.length - 1] !== max) result.push(max);
    // Wenn zu wenig Schritte, ergänze linear
    while (result.length < steps + 1) {
      const last = result[result.length - 1];
      result.push(Math.round(last + (max / steps)));
    }
    // Wenn zu viele, dünne aus
    if (result.length > steps + 1) {
      const keep = [0];
      const step = (result.length - 1) / steps;
      for (let i = 1; i < steps; i++) {
        keep.push(result[Math.round(i * step)]);
      }
      keep.push(max);
      result = keep;
    }
    return result;
  }

  const legendSteps = getNiceIntervals(minValue, maxValueLegend, colorSteps.length);

  const getColor = (value: number) => {
    if (!Number.isFinite(value) || value === 0) return colorSteps[0];
    // Finde das passende Intervall für den Wert
    let step = 0;
    for (let i = 0; i < legendSteps.length - 1; i++) {
      if (value >= legendSteps[i] && value < legendSteps[i + 1]) {
        step = i;
        break;
      }
      // Wenn Wert gleich max, dann letztes Intervall
      if (value === legendSteps[legendSteps.length - 1]) {
        step = colorSteps.length - 1;
      }
    }
    if (step < 0) step = 0;
    if (step >= colorSteps.length) step = colorSteps.length - 1;
    return colorSteps[step];
  };

  // Get text color based on background color
  const getTextColor = (value: number) => {
    const normalized = value / maxValue;
    return normalized > 0.6 ? '#ffffff' : '#000000';
  };

  // Get value for a specific day and hour
  const getValue = (day: number, hour: number) => {
    const cell = heatmapData.find(d => d.day === day && d.hour === hour);
    return cell ? Math.round(cell.value) : 0;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Weekly Traffic Pattern</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] flex items-center justify-center">
            <div className="animate-pulse text-gray-400">Loading heatmap data...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {dateRange && dateRange.type === 'day'
            ? `Traffic Pattern - ${street}`
            : dateRange && dateRange.type === 'week'
            ? `Weekly Traffic Pattern (${format(dateRange.start, 'd MMM')} - ${format(dateRange.end, 'd MMM')}) - ${street}`
            : `Traffic Pattern - ${street}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="overflow-x-auto">
          <div className="w-full min-w-0">
            {/* Time labels on top */}
            <div className="flex">
              <div className="w-24" /> {/* Space for day labels */}
              {hours.map(hour => (
                <div
                  key={hour}
                  className="flex-1 text-center text-xs text-gray-600 dark:text-gray-400"
                >
                  {hour.toString().padStart(2, '0')}
                </div>
              ))}
            </div>

            {/* Heatmap grid */}
            {daysToShow.map((day, idx) => (
              <div key={day} className="flex items-center">
                <div className="w-24 text-xs text-gray-600 dark:text-gray-400 pr-2">
                  {dayLabels[idx]}
                </div>
                {hours.map(hour => {
                  const value = getValue(day, hour);
                  return (
                    <div
                      key={hour}
                      className="flex-1 aspect-square border border-gray-100 dark:border-gray-800 relative group min-w-[12px]"
                      style={{
                        backgroundColor: getColor(value),
                        transition: 'background-color 0.2s',
                      }}
                    >
                      {/* Tooltip */}
                      <div className="absolute hidden group-hover:block z-10 p-2 bg-black text-white text-xs rounded shadow-lg -top-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                        {value} pedestrians
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Legend as horizontal color scale with compact boundaries below */}
            <div className="mt-3 w-full">
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-1.5">Traffic density</div>

              {/* Color scale */}
              <div className="flex items-center w-full">
                <div className="flex-1 h-3 rounded overflow-hidden flex">
                  {colorSteps.map((color, i) => (
                    <div
                      key={i}
                      style={{ backgroundColor: color, flex: 1 }}
                    />
                  ))}
                </div>
              </div>

              {/* Verbesserte Intervall-Labels */}
              <div className="mt-0.5 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                {legendSteps.map((v, i) => (
                  <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                    {v}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
