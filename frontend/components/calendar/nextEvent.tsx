'use client';

import { CalendarEvent } from '@/lib/types';
import { format, isAfter, isSameDay, addMonths } from 'date-fns';
import { CalendarIcon, Music } from 'lucide-react';

interface NextEventProps {
  events: CalendarEvent[];
}

export function NextEvent({ events }: NextEventProps) {
  const today = new Date();
  const maxDate = addMonths(today, 4); // Look 4 months ahead

  if (!events || events.length === 0) {
    return (
      <div className="p-3 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <p className="text-sm text-gray-500 dark:text-gray-400">No upcoming events</p>
      </div>
    );
  }

  // Only real events
  const relevantEvents = events.filter(e => e.type === 'event' || e.type === 'concert');

  // Next event within the next 4 months
  const upcomingEvent = relevantEvents
    .filter(e => {
      const eventDate = new Date(e.date);
      return (isAfter(eventDate, today) || isSameDay(eventDate, today)) && isAfter(maxDate, eventDate);
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

  if (!upcomingEvent) {
    return (
      <div className="p-3 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <p className="text-sm text-gray-500 dark:text-gray-400">No upcoming events in the next 4 months</p>
      </div>
    );
  }

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'concert': return <Music className="h-5 w-5 text-purple-500" />;
      case 'event':
      default: return <CalendarIcon className="h-5 w-5 text-green-500" />;
    }
  };

  return (
    <div className="p-4 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shadow-sm">
      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Next Upcoming Event
      </h4>
      <div className="flex items-center space-x-3">
        {getEventIcon(upcomingEvent.type)}
        <div>
          <p className="text-sm font-semibold dark:text-gray-200">{upcomingEvent.name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {format(new Date(upcomingEvent.date), 'PPP')}
          </p>
        </div>
      </div>
    </div>
  );
}
