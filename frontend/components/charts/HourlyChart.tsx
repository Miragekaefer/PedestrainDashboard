import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useQuantileHighlight } from '@/lib/hooks/useQuantileHighlight';
import { HourlyDataPoint, DashboardFilters } from '@/lib/types';

interface Props {
  hourlyData: HourlyDataPoint[];
  dateRange: DashboardFilters['dateRange'];
}

export function HourlyChart({ hourlyData, dateRange }: Props) {
  const { highlightedData, highLineData } = useQuantileHighlight(hourlyData, 0.7, dateRange);

  return (
    <div className="h-96">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={highlightedData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="hour" tickFormatter={(v) => `${v}:00`} />
          <YAxis />
          <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Pedestrians']} />
          <Legend />
          <Line type="monotone" dataKey="total" stroke="#8884d8" strokeWidth={2} dot={false} />
          <Line
            type="monotone"
            data={highLineData}
            dataKey="total"
            stroke="#FF4C4C"
            strokeWidth={2}
            dot={false}
            name="High Traffic Hours"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
