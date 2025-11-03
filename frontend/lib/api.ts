import {
  PedestrianData,
  StreetsResponse,
  CalendarInfo,
  EventsResponse,
  HistoricalDataResponse,
  StatisticsData,
  HourlyDataPoint,
  DailyDataPoint
} from './types';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay } from 'date-fns';
import type { PredictionResponse } from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

class PedestrianAPI {
  private async fetchWithErrorHandling(url: string, options?: RequestInit): Promise<unknown> {
    try {
      const response = await fetch(`${API_BASE_URL}${url}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        ...options,
      });

      if (!response.ok) {
        const errorMessage = `API Error: ${response.status} ${response.statusText}`;
        console.error(`API call failed for ${url}:`, errorMessage);
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      console.error(`API call failed for ${url}:`, error);
      throw error;
    }
  }

  // Streets API
  async getStreets(): Promise<StreetsResponse> {
    return this.fetchWithErrorHandling('/api/streets') as Promise<StreetsResponse>;
  }

  // Historical Data API
  async getHistoricalData(
    street: string,
    startDate: string,
    endDate: string,
    limit?: number
  ): Promise<HistoricalDataResponse> {
    const params = new URLSearchParams({
      street,
      start_date: startDate,
      end_date: endDate,
    });

    if (limit) {
      params.append('limit', limit.toString());
    }

    return this.fetchWithErrorHandling(`/api/pedestrians/historical?${params}`) as Promise<HistoricalDataResponse>;
  }

  // Calendar API
  async getCalendarInfo(date: string): Promise<CalendarInfo> {
    return this.fetchWithErrorHandling(`/api/calendar/${date}`) as Promise<CalendarInfo>;
  }

  // Events API
  async getEventsForDate(date: string): Promise<EventsResponse> {
    return this.fetchWithErrorHandling(`/api/events/${date}`) as Promise<EventsResponse>;
  }

  // prediction API
  async getPredictionData(
    street: string,
    start: string,
    end: string
  ): Promise<PredictionResponse> {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/pedestrians/predictions?street=${encodeURIComponent(street)}&start_date=${start}&end_date=${end}`
      );

      if (!response.ok) {
        throw new Error(`Prediction API failed: ${response.status}`);
      }

      const data = await response.json();
      return data as PredictionResponse;
    } catch (error) {
      console.error("Failed to fetch prediction data:", error);
      return {
        street,
        requested_period: { start, end },
        actual_coverage: { start: null, end: null, hours_covered: 0 },
        count: 0,
        predictions: [],
        metadata: { note: "No prediction data available" },
      };
    }
  }

  // Statistics calculation
  async getStatistics(
    street: string,
    startDate: string,
    endDate: string
  ): Promise<StatisticsData> {
    const data = await this.getHistoricalData(street, startDate, endDate);

    if (data.data.length === 0) {
      return {
        totalPedestrians: 0,
        avgHourlyCount: 0,
        peakHour: 0,
        peakCount: 0,
        directionRatio: 0,
        weatherImpact: 'low'
      };
    }

    const total = data.data.reduce((sum, item) => sum + item.n_pedestrians, 0);
    const avgHourly = total / data.data.length;

    // Find peak hour
    const hourlyGroups = data.data.reduce((acc, item) => {
      const hour = parseInt(item.hour);
      if (!acc[hour]) acc[hour] = [];
      acc[hour].push(item.n_pedestrians);
      return acc;
    }, {} as Record<number, number[]>);

    let peakHour = 0;
    let peakCount = 0;
    Object.entries(hourlyGroups).forEach(([hour, counts]) => {
      const hourTotal = counts.reduce((sum, count) => sum + count, 0);
      if (hourTotal > peakCount) {
        peakCount = hourTotal;
        peakHour = parseInt(hour);
      }
    });

    // Direction ratio (towards / total)
    const towardsTotal = data.data.reduce((sum, item) => sum + item.n_pedestrians_towards, 0);
    const directionRatio = total > 0 ? (towardsTotal / total) * 100 : 0;

    // Simple weather impact calculation
    const weatherImpact = this.calculateWeatherImpact(data.data);

    return {
      totalPedestrians: total,
      avgHourlyCount: Math.round(avgHourly),
      peakHour,
      peakCount,
      directionRatio: Math.round(directionRatio),
      weatherImpact
    };
  }

  private calculateWeatherImpact(data: PedestrianData[]): 'low' | 'medium' | 'high' {
    // Simple heuristic based on temperature correlation
    const validData = data.filter(item => item.temperature !== null && item.temperature !== undefined);
    if (validData.length < 10) return 'low';

    const temps = validData.map(item => item.temperature!);
    const counts = validData.map(item => item.n_pedestrians);

    const correlation = this.calculateCorrelation(temps, counts);
    const absCorrelation = Math.abs(correlation);

    if (absCorrelation > 0.7) return 'high';
    if (absCorrelation > 0.4) return 'medium';
    return 'low';
  }

  private calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  }

  // Data transformation helpers
  transformToHourlyData(data: any[]): HourlyDataPoint[] {
    return data.map(d => ({
      date: d.date ? d.date.split('T')[0] : '',
      hour: Number(d.hour ?? new Date(d.timestamp).getHours()),
      total: d.n_pedestrians ?? 0,
      towards: d.towards ?? 0,
      away: d.away ?? 0,
      isHigh: false,
    }));
  }

  transformToDailyData(data: PedestrianData[]): DailyDataPoint[] {
    const dailyGroups = data.reduce((acc, item) => {
      const date = item.date;
      if (!acc[date]) {
        acc[date] = { total: 0, hours: 0 };
      }
      acc[date].total += item.n_pedestrians;
      acc[date].hours += 1;
      return acc;
    }, {} as Record<string, { total: number; hours: number }>);

    return Object.entries(dailyGroups).map(([date, data]) => ({
      date,
      total: data.total,
      avgHourly: Math.round(data.total / data.hours),
      weekday: new Date(date).toLocaleDateString('en-US', { weekday: 'long' })
    }));
  }
}

// Export singleton instance
export const pedestrianAPI = new PedestrianAPI();
