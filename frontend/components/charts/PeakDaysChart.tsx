import {
  ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar, Line, LabelList, ResponsiveContainer,
} from 'recharts';
import { DailyWithPeak } from '@/components/utils/peakhourDay';
import { DashboardFilters } from '@/lib/types';
import { format } from 'date-fns';

interface Props {
  dailyWithPeaks: DailyWithPeak[];
  dateRange: DashboardFilters['dateRange'];
}

export function PeakDaysChart({ dailyWithPeaks, dateRange }: Props) {
  return (
    <div className="h-96">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={dailyWithPeaks}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey={dateRange.type === 'day' ? 'hour' : 'date'}
            tickFormatter={(value) =>
              dateRange.type === 'day'
                ? `${value}:00`
                : (() => {
                    const d = new Date(String(value));
                    return isNaN(d.getTime()) ? String(value) : format(d, 'MMM dd');
                  })()
            }
          />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar
            dataKey="peakCount"
            barSize={24}
            fill="rgba(255, 76, 76, 0.5)"
            name="Peak Hour Count"
            radius={[4, 4, 0, 0]}
          >
            <LabelList dataKey="peakCount" position="top" fill="#FF0000" fontSize={12} />
          </Bar>
          <Line
            type="monotone"
            dataKey="total"
            stroke="#3366cc"
            strokeWidth={2}
            name="Total Pedestrians"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
