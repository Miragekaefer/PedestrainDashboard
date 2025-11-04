'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Music, Gift, GraduationCap, CalendarDays } from 'lucide-react';
import { format, isSameDay, isAfter } from 'date-fns';
import { CalendarEvent, DashboardFilters } from '@/lib/types';
import { NextEvent } from '@/components/calendar/nextEvent';

interface CalendarComponentProps {
  events: CalendarEvent[];                
  futureEvents?: CalendarEvent[];        
  loading: boolean;
  dateRange: DashboardFilters['dateRange'];
}

// Quick fix: shift date by one day for calendar display
const fixDate = (date: string | Date) => {
  const d = new Date(date);
  d.setDate(d.getDate() );
  return d;
};

export function CalendarComponent({ events, futureEvents, loading, dateRange }: CalendarComponentProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());

  // Group events by type
  const eventTypes = events.reduce((acc, event) => {
    if (!acc[event.type]) acc[event.type] = [];
    acc[event.type].push(event);
    return acc;
  }, {} as Record<string, CalendarEvent[]>);

  // Events for selected date
  const selectedDateEvents = events.filter(
    event => selectedDate && isSameDay(fixDate(event.date), selectedDate)
  );

  // Calendar modifiers
  const holidayDates = events.filter(e => e.type === 'holiday').map(e => fixDate(e.date));
  const schoolHolidayDates = events.filter(e => e.type === 'school_holiday').map(e => fixDate(e.date));
  const eventDates = events.filter(e => e.type === 'event').map(e => fixDate(e.date));
  const concertDates = events.filter(e => e.type === 'concert').map(e => fixDate(e.date));
  const lectureDates = events.filter(e => e.type === 'lecture').map(e => fixDate(e.date));

  const modifiers = {
    holiday: holidayDates,
    schoolHoliday: schoolHolidayDates,
    event: eventDates,
    concert: concertDates,
    lecture: lectureDates,
  };

  const modifiersClassNames = {
    holiday: 'bg-red-500/20 text-red-600 dark:bg-red-500/30 dark:text-red-400 font-semibold border-red-500/50',
    schoolHoliday: 'bg-blue-500/20 text-blue-600 dark:bg-blue-500/30 dark:text-blue-400 font-semibold border-blue-500/50',
    event: 'bg-green-500/20 text-green-600 dark:bg-green-500/30 dark:text-green-400 font-semibold border-green-500/50',
    concert: 'bg-purple-500/20 text-purple-600 dark:bg-purple-500/30 dark:text-purple-400 font-semibold border-purple-500/50',
    lecture: 'bg-orange-500/20 text-orange-600 dark:bg-orange-500/30 dark:text-orange-400 font-semibold border-orange-500/50',
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'holiday': return <Gift className="h-3 w-3" />;
      case 'school_holiday': return <CalendarDays className="h-3 w-3" />;
      case 'event': return <CalendarIcon className="h-3 w-3" />;
      case 'concert': return <Music className="h-3 w-3" />;
      case 'lecture': return <GraduationCap className="h-3 w-3" />;
      default: return <CalendarIcon className="h-3 w-3" />;
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case 'holiday': return 'bg-red-500 dark:bg-red-400';
      case 'school_holiday': return 'bg-blue-500 dark:bg-blue-400';
      case 'event': return 'bg-green-500 dark:bg-green-400';
      case 'concert': return 'bg-purple-500 dark:bg-purple-400';
      case 'lecture': return 'bg-orange-500 dark:bg-orange-400';
      default: return 'bg-gray-500 dark:bg-gray-400';
    }
  };

  const getEventLabel = (type: string) => {
    switch (type) {
      case 'holiday': return 'Public Holiday';
      case 'school_holiday': return 'School Holiday';
      case 'event': return 'Event';
      case 'concert': return 'Concert';
      case 'lecture': return 'Lecture Period';
      default: return 'Other';
    }
  };

  if (loading) {
    return (
      <Card className="animate-pulse">
        <CardHeader>
          <div className="h-6 bg-gray-200 rounded w-32"></div>
        </CardHeader>
        <CardContent>
          <div className="h-80 bg-gray-200 rounded"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <CalendarIcon className="h-5 w-5" />
          <span>Event Calendar</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Next Upcoming Event Box — use futureEvents (independent), fallback to calendar events */}
        <NextEvent events={futureEvents && futureEvents.length > 0 ? futureEvents : events} />

        {/* Legend */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Legend</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(eventTypes).length > 0 ? (
              Object.entries(eventTypes).map(([type, typeEvents]) => (
                <Badge key={type} variant="outline" className="flex items-center space-x-1">
                  <div className={`w-2 h-2 rounded-full ${getEventColor(type)}`} />
                  <span>{getEventLabel(type)}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">({typeEvents.length})</span>
                </Badge>
              ))
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No events in selected period</p>
            )}
          </div>
        </div>

        {/* Calendar */}
        <div className="space-y-4">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={setSelectedDate}
            month={currentMonth}
            onMonthChange={setCurrentMonth}
            className="rounded-md border"
            modifiers={modifiers}
            modifiersClassNames={modifiersClassNames}
          />
        </div>

        {/* Selected Date Events */}
        {selectedDate && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Events on {format(selectedDate, 'PPP')}
            </h4>
            {selectedDateEvents.length > 0 ? (
              <div className="space-y-2">
                {selectedDateEvents.map((event, index) => (
                  <div
                    key={index}
                    className="flex items-center space-x-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-800"
                  >
                    <div className={`w-3 h-3 rounded-full ${getEventColor(event.type)}`} />
                    <div className="flex-1">
                      <p className="text-sm font-medium dark:text-gray-200">{event.name}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{event.description}</p>
                    </div>
                    {getEventIcon(event.type)}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No events on this date</p>
            )}
          </div>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t dark:border-gray-700">
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{events.length}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">Total Events</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{Object.keys(eventTypes).length}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">Event Types</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
