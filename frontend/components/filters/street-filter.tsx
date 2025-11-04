'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MapPin } from 'lucide-react';

interface StreetFilterProps {
  streets: string[];
  selectedStreet: string;
  onStreetChange: (street: string) => void;
}

export function StreetFilter({ streets, selectedStreet, onStreetChange }: StreetFilterProps) {
  // Add "All_streets" at the top
  const options = ['All_streets', ...streets];

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700 flex items-center space-x-2">
        <MapPin className="h-4 w-4" />
        <span>Street Location</span>
      </label>
      <Select value={selectedStreet} onValueChange={onStreetChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a street" />
        </SelectTrigger>
          <SelectContent>
            <SelectItem key="All_streets" value="All_streets">
              All Streets
            </SelectItem>
            {streets.map((street) => (
              <SelectItem key={street} value={street}>
                {street}
              </SelectItem>
            ))}
          </SelectContent>
      </Select>
    </div>
  );
}
