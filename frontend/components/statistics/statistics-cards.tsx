'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, TrendingUp, Clock, Activity } from 'lucide-react';
import { StatisticsData } from '@/lib/types';

interface StatisticsCardsProps {
  statistics: StatisticsData | null;
  loading: boolean;
  street: string;
  currentWeather?: { condition?: string; temperature?: number } | null;
  showWeather?: boolean;
}

export function StatisticsCards({ statistics, loading, street, currentWeather, showWeather = true }: StatisticsCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 bg-gray-200 rounded w-24"></div>
              <div className="h-4 w-4 bg-gray-200 rounded"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-gray-200 rounded w-16 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-32"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!statistics) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-gray-500">
            <p>No data available for the selected period</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toLocaleString();
  };

  const getWeatherImpactColor = (impact: string) => {
    switch (impact) {
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      default: return 'outline';
    }
  };

  // Tailwind background/text classes for each impact level
  const getWeatherImpactBgClass = (impact: string) => {
    switch (impact) {
      case 'high':
        return 'bg-red-600 text-white';
      case 'medium':
        return 'bg-yellow-400 text-black';
      default:
        return 'bg-gray-200 text-gray-800';
    }
  };

  const getWeatherImpactText = (impact: string) => {
    switch (impact) {
      case 'high': return 'High Impact';
      case 'medium': return 'Medium Impact';
      default: return 'Low Impact';
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {/* Total Pedestrians */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Pedestrians</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatNumber(statistics.totalPedestrians)}</div>
          <p className="text-xs text-muted-foreground">
            {street} • {statistics.avgHourlyCount} avg/hour
          </p>
        </CardContent>
      </Card>

      {/* Peak Hour */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Peak Hour</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {statistics.peakHour}:00
          </div>
          <p className="text-xs text-muted-foreground">
            {formatNumber(statistics.peakCount)} pedestrians
          </p>
        </CardContent>
      </Card>

      {/* Direction Ratio */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Direction Flow</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {statistics.directionRatio}%
          </div>
          <p className="text-xs text-muted-foreground">
            towards city center
          </p>
        </CardContent>
      </Card>

      {/* Weather Impact */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Weather Impact</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {showWeather && currentWeather ? (
            <div className="mb-2">
              <div className="flex items-center space-x-3">
                <div className="text-sm font-medium">
                  {currentWeather.temperature !== undefined ? `${Math.round(currentWeather.temperature)}°C` : '—'}
                </div>
                <div className="text-xs text-muted-foreground capitalize">
                  {currentWeather.condition || 'Unknown'}
                </div>
              </div>
            </div>
          ) : showWeather && !currentWeather ? (
            <p className="text-xs text-muted-foreground mb-2">Current weather not available</p>
          ) : null}

          <Badge variant={getWeatherImpactColor(statistics.weatherImpact)} className={`mb-2 ${getWeatherImpactBgClass(statistics.weatherImpact)}`}>
            {getWeatherImpactText(statistics.weatherImpact)}
          </Badge>

          <p className="text-xs text-muted-foreground">
            on pedestrian count
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
