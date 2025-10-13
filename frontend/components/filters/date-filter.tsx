'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Clock } from 'lucide-react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay } from 'date-fns';
import { DashboardFilters } from '@/lib/types';

interface DateFilterProps {
  dateRange: DashboardFilters['dateRange'];
  onDateRangeChange: (dateRange: DashboardFilters['dateRange']) => void;
}

export function DateFilter({ dateRange, onDateRangeChange }: DateFilterProps) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [customDate, setCustomDate] = useState<Date | undefined>(dateRange.start);

  const handlePeriodTypeChange = (type: 'day' | 'week' | 'month') => {
    // Use the current custom date if available, otherwise use today
    const baseDate = customDate || new Date();
    let start: Date;
    let end: Date;

    switch (type) {
      case 'day':
        start = startOfDay(baseDate);
        end = endOfDay(baseDate);
        break;
      case 'week':
        start = startOfWeek(baseDate, { weekStartsOn: 1 }); // Start week on Monday
        end = endOfWeek(baseDate, { weekStartsOn: 1 });
        break;
      case 'month':
        start = startOfMonth(baseDate);
        end = endOfMonth(baseDate);
        break;
      default:
        return;
    }

    onDateRangeChange({ type, start, end });
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setCustomDate(date);
      let start: Date;
      let end: Date;

      // Apply the current period type to the selected date
      switch (dateRange.type) {
        case 'day':
          start = startOfDay(date);
          end = endOfDay(date);
          break;
        case 'week':
          start = startOfWeek(date, { weekStartsOn: 1 });
          end = endOfWeek(date, { weekStartsOn: 1 });
          break;
        case 'month':
          start = startOfMonth(date);
          end = endOfMonth(date);
          break;
        default:
          start = startOfDay(date);
          end = endOfDay(date);
      }

      onDateRangeChange({ type: dateRange.type, start, end });
      setIsCalendarOpen(false);
    }
  };

  return (
    <div className="space-y-4">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center space-x-2">
        <Clock className="h-4 w-4" />
        <span>Time Period</span>
      </label>

      {/* Period Type Selection */}
      <Select value={dateRange.type} onValueChange={handlePeriodTypeChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select time period" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="day">Single Day</SelectItem>
          <SelectItem value="week">This Week</SelectItem>
          <SelectItem value="month">This Month</SelectItem>
        </SelectContent>
      </Select>

      {/* Date Picker for Custom Selection */}
      <div className="space-y-2">
        <label className="text-sm text-gray-600 dark:text-gray-400">Select a date:</label>
        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-start text-left font-normal text-sm"
            >
              <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
              <span className="truncate">
                {dateRange.type === 'day'
                  ? format(dateRange.start, 'MMM dd, yyyy')
                  : dateRange.type === 'week'
                  ? `Week: ${format(dateRange.start, 'MMM dd')} - ${format(dateRange.end, 'dd')}`
                  : `${format(dateRange.start, 'MMM dd')} - ${format(dateRange.end, 'MMM dd')}`
                }
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateRange.start}
              onSelect={handleDateSelect}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Current Selection Info */}
      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 pt-2 border-t dark:border-gray-700">
        <div className="flex justify-between">
          <span>Period:</span>
          <span className="font-medium">{Math.ceil((dateRange.end.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24)) + 1} days</span>
        </div>
        <div className="flex justify-between">
          <span>From:</span>
          <span className="font-medium">{format(dateRange.start, 'MMM dd')}</span>
        </div>
        <div className="flex justify-between">
          <span>To:</span>
          <span className="font-medium">{format(dateRange.end, 'MMM dd')}</span>
        </div>
      </div>
    </div>
  );
}
