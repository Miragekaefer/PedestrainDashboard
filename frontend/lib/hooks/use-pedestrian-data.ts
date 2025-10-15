import { useQuery } from '@tanstack/react-query';
import { pedestrianAPI } from '../api';
import { format } from 'date-fns';

export function useStreets() {
  return useQuery({
    queryKey: ['streets'],
    queryFn: () => pedestrianAPI.getStreets(),
  });
}

export function useHistoricalData(street: string, startDate: Date, endDate: Date) {
  const start = format(startDate, 'yyyy-MM-dd');
  const end = format(endDate, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['historical', street, start, end],
    queryFn: () => pedestrianAPI.getHistoricalData(street, start, end),
    enabled: !!street && !!startDate && !!endDate,
  });
}

export function useStatistics(street: string, startDate: Date, endDate: Date) {
  const start = format(startDate, 'yyyy-MM-dd');
  const end = format(endDate, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['statistics', street, start, end],
    queryFn: () => pedestrianAPI.getStatistics(street, start, end),
    enabled: !!street && !!startDate && !!endDate,
  });
}

export function useCalendarInfo(date: Date) {
  const dateStr = format(date, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['calendar', dateStr],
    queryFn: () => pedestrianAPI.getCalendarInfo(dateStr),
    enabled: !!date,
  });
}

export function useEventsForDate(date: Date) {
  const dateStr = format(date, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['events', dateStr],
    queryFn: () => pedestrianAPI.getEventsForDate(dateStr),
    enabled: !!date,
  });
}
