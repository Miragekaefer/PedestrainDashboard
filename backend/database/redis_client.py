# backend/database/redis_client.py
import redis
import json
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import config 

class PedestrianRedisClient:
    def __init__(self, host='localhost', port=6379, db=0):
        self.client = redis.Redis(
            host=host or config.REDIS_HOST, 
            port=port or config.REDIS_PORT, 
            db=db, 
            decode_responses=True
        )
        print(f"Connected to Redis at {host or config.REDIS_HOST}:{port or config.REDIS_PORT}")
    
    # ============================================
    # ALL EVENTS (FOR MODEL TRAINING)
    # ============================================

    def get_all_events(self) -> List[Dict]:
        """
        Returns clean event data for ML model:
        {
            "date": "YYYY-MM-DD",
            "datetime": "YYYY-MM-DD HH:00:00",
            "event": int,
            "concert": int
        }
        """

        events = []
        keys = self.client.keys("event:*")

        for key in keys:
            parts = key.split(":")

            # Only allow event:YYYY-MM-DD:HH
            if len(parts) != 3:
                continue

            _, date_str, hour_str = parts

            # Validate date
            try:
                datetime.strptime(date_str, "%Y-%m-%d")
            except:
                continue

            # Validate hour
            try:
                hour = int(hour_str)
            except:
                continue

            raw = self.client.hgetall(key) or {}

            event_flag = int(raw.get("has_event", "0"))
            concert_flag = int(raw.get("has_concert", "0"))

            dt = f"{date_str} {hour:02d}:00:00"

            events.append({
                "date": date_str,
                "datetime": dt,
                "event": event_flag,
                "concert": concert_flag
            })

        return events



    # ============================================
    # ALL LECTURES (FOR MODEL TRAINING)
    # ============================================

    def get_all_lecture_dates(self) -> List[str]:
        """Return all lecture dates from Redis (matches your real schema)."""
        keys = self.client.keys("lecture:daily:*")  # Changed from "lecture:*"
        dates = []

        for key in keys:
            parts = key.split(":")
            if len(parts) == 3:  # Changed from 2 to 3
                dates.append(parts[2])  # Changed from parts[1] to parts[2]

        return dates

    def get_all_lectures(self) -> List[Dict]:
        dates = self.get_all_lecture_dates()
        results = []

        for date in dates:
            info = self.get_lecture_info(date)
            if info:
                results.append(info)

        return results

    # ============================================
    # ALL HOLIDAYS (FOR MODEL TRAINING)
    # ============================================

    def get_all_public_holidays(self) -> List[Dict]:
        """Return all public holidays"""
        keys = self.client.keys("holiday:*") or []
        holidays = []

        for key in keys:
            data = self.client.hgetall(key)
            if data:
                holidays.append({
                    "date": data.get("date"),
                    "is_holiday": int(data.get("is_holiday", 0)),
                    "is_nationwide": int(data.get("is_nationwide", 0))
                })
        
        return holidays

    # ============================================
    # ALL SCHOOL HOLIDAYS (FOR MODEL TRAINING)
    # ============================================

    def get_all_school_holiday_dates(self) -> List[str]:
        """Return all dates that are school holidays"""
        return list(self.client.smembers('school_holidays:all') or [])

    # ============================================
    # PASSANTENDATEN
    # ============================================
    
    def store_hourly_data(self, street: str, data: Dict):
        """Speichert stündliche Passantendaten MIT Index"""
        key = f"pedestrian:hourly:{street}:{data['date']}:{data['hour']}"
        
        # 1. Daten speichern
        self.client.hset(key, mapping=data)
        self.client.expire(key, 60*60*24*730)
        
        # 2. Index-Eintrag erstellen
        self._add_to_index(street, key, data['date'], data['hour'])

    def _add_to_index(self, street: str, key: str, date: str, hour: str):
        """Fügt Key zum Sorted Set Index hinzu"""
        try:
            timestamp = f"{date}T{str(hour).zfill(2)}:00:00"
            score = datetime.fromisoformat(timestamp).timestamp()
            
            index_key = f"pedestrian:index:{street}"
            self.client.zadd(index_key, {key: score})
            self.client.expire(index_key, 60*60*24*730)
        except Exception as e:
            # Falls Indexierung fehlschlägt, loggen aber nicht abbrechen
            print(f"Warning: Could not add to index: {e}")
    
    def get_hourly_data(self, street: str, date: str, hour: int) -> Optional[Dict]:
        """Holt stündliche Daten"""
        key = f"pedestrian:hourly:{street}:{date}:{hour}"
        data = self.client.hgetall(key)
        return data if data else None
    
    def get_historical_range(self, street: str, start_date: str, end_date: str) -> List[Dict]:
        """
        Intelligente Range-Query mit automatischem Fallback
        Nutzt Index wenn verfügbar, sonst SCAN
        """
        index_key = f"pedestrian:index:{street}"
        
        # Prüfe ob Index existiert
        if self.client.exists(index_key):
            return self._get_range_via_index(street, start_date, end_date)
        else:
            return self._get_range_via_scan(street, start_date, end_date)
        
    def _get_range_via_index(self, street: str, start_date: str, end_date: str) -> List[Dict]:
        """Schnelle Methode mit Sorted Set Index - O(log N)"""
        index_key = f"pedestrian:index:{street}"
        
        # Konvertiere zu Timestamps
        start_ts = datetime.fromisoformat(f"{start_date}T00:00:00").timestamp()
        end_ts = datetime.fromisoformat(f"{end_date}T23:59:59").timestamp()
        
        # Hole Keys aus Index (O(log N))
        keys = self.client.zrangebyscore(index_key, start_ts, end_ts)
        
        if not keys:
            return []
        
        # Hole alle Daten mit Pipeline (1 Round-Trip)
        pipe = self.client.pipeline()
        for key in keys:
            pipe.hgetall(key)
        
        results = pipe.execute()
        
        # Filtere leere und sortiere
        valid_results = [r for r in results if r]
        return sorted(valid_results, key=lambda x: (x.get('date', ''), int(x.get('hour', 0))))

    def _get_range_via_scan(self, street: str, start_date: str, end_date: str) -> List[Dict]:
        """Fallback mit SCAN für Daten ohne Index"""
        pattern = f"pedestrian:hourly:{street}:*"
        
        # Phase 1: Sammle Keys mit SCAN
        matching_keys = []
        cursor = 0
        
        while True:
            cursor, keys = self.client.scan(
                cursor=cursor,
                match=pattern,
                count=1000
            )
            
            # Filtere Keys nach Datum
            for key in keys:
                parts = key.split(':')
                if len(parts) >= 4:
                    key_date = parts[3]
                    if start_date <= key_date <= end_date:
                        matching_keys.append(key)
            
            if cursor == 0:
                break
        
        if not matching_keys:
            return []
        
        # Phase 2: Hole Daten mit Pipeline
        pipe = self.client.pipeline()
        for key in matching_keys:
            pipe.hgetall(key)
        
        results = pipe.execute()
        valid_results = [r for r in results if r]
        return sorted(valid_results, key=lambda x: (x.get('date', ''), int(x.get('hour', 0))))
    
    def bulk_store_hourly_data(self, street: str, data_list: List[Dict]):
        """Bulk Insert mit Pipeline UND Indexierung"""
        pipe = self.client.pipeline()
        index_key = f"pedestrian:index:{street}"
        
        for data in data_list:
            key = f"pedestrian:hourly:{street}:{data['date']}:{data['hour']}"
            
            # Daten speichern
            pipe.hset(key, mapping=data)
            pipe.expire(key, 60*60*24*730)
            
            # Index-Eintrag
            try:
                timestamp = f"{data['date']}T{str(data['hour']).zfill(2)}:00:00"
                score = datetime.fromisoformat(timestamp).timestamp()
                pipe.zadd(index_key, {key: score})
            except:
                pass
        
        # Index TTL
        pipe.expire(index_key, 60*60*24*730)
        pipe.execute()
    
    # ============================================
    # PREDICTIONS
    # ============================================
    
    def get_prediction_range(self, street: str, start_date: str, end_date: str) -> List[Dict]:
        """
        Retrieves predictions for a street within a date range.
        Unlike historical data, predictions may not have complete 24-hour coverage.
        
        Args:
            street: Street name
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
        
        Returns:
            List of prediction dictionaries sorted by timestamp
        """
        try:
            start = datetime.strptime(start_date, '%Y-%m-%d')
            end = datetime.strptime(end_date, '%Y-%m-%d')
            
            predictions = []
            current_date = start
            
            # Build list of keys to check
            keys_to_check = []
            while current_date <= end:
                date_str = current_date.strftime('%Y-%m-%d')
                
                # Check all 24 hours for each day
                for hour in range(24):
                    key = f"pedestrian:hourly:prediction:{street}:{date_str}:{hour}"
                    keys_to_check.append(key)
                
                current_date += timedelta(days=1)
            
            # Use pipeline for efficiency (batch Redis calls)
            if keys_to_check:
                pipe = self.client.pipeline()
                for key in keys_to_check:
                    pipe.exists(key)
                
                # Check which keys exist
                existence_checks = pipe.execute()
                
                # Only fetch data for existing keys
                existing_keys = [key for key, exists in zip(keys_to_check, existence_checks) if exists]
                
                if existing_keys:
                    pipe = self.client.pipeline()
                    for key in existing_keys:
                        pipe.hgetall(key)
                    
                    results = pipe.execute()
                    predictions = [r for r in results if r]
            
            # Sort by timestamp
            return sorted(predictions, key=lambda x: (x.get('date', ''), int(x.get('hour', 0))))
        
        except Exception as e:
            print(f"Error fetching predictions for {street}: {e}")
            return []


    def get_prediction_count(self, street: Optional[str] = None) -> int:
        """
        Count available predictions.
        
        Args:
            street: Optional street name. If None, counts all predictions.
        
        Returns:
            Number of prediction records
        """
        try:
            if street:
                pattern = f"pedestrian:hourly:prediction:{street}:*"
            else:
                pattern = "pedestrian:hourly:prediction:*"
            
            count = 0
            cursor = 0
            
            while True:
                cursor, keys = self.client.scan(
                    cursor=cursor,
                    match=pattern,
                    count=1000
                )
                count += len(keys)
                
                if cursor == 0:
                    break
            
            return count
        
        except Exception as e:
            print(f"Error counting predictions: {e}")
            return 0


    def get_latest_prediction_timestamp(self, street: str) -> Optional[str]:
        """
        Get the timestamp of the latest available prediction for a street.
        
        Args:
            street: Street name
        
        Returns:
            ISO timestamp string or None
        """
        try:
            pattern = f"pedestrian:hourly:prediction:{street}:*"
            
            # Scan for all prediction keys
            all_keys = []
            cursor = 0
            
            while True:
                cursor, keys = self.client.scan(
                    cursor=cursor,
                    match=pattern,
                    count=1000
                )
                all_keys.extend(keys)
                
                if cursor == 0:
                    break
            
            if not all_keys:
                return None
            
            # Get timestamps using pipeline
            pipe = self.client.pipeline()
            for key in all_keys:
                pipe.hget(key, 'timestamp')
            
            timestamps = pipe.execute()
            valid_timestamps = [ts for ts in timestamps if ts]
            
            if valid_timestamps:
                return max(valid_timestamps)
            
            return None
        
        except Exception as e:
            print(f"Error getting latest prediction timestamp: {e}")
            return None
    
    # ============================================
    # FEIERTAGE
    # ============================================
    
    def get_holiday_info(self, date: str) -> Optional[Dict]:
        """Holt Feiertagsinformationen"""
        key = f"holiday:{date}"
        data = self.client.hgetall(key)
        
        if data:
            return {
                'date': data['date'],
                'is_holiday': bool(int(data.get('is_holiday', 0))),
                'is_nationwide': bool(int(data.get('is_nationwide', 0)))
            }
        return None
    
    def get_detailed_holiday_info(self, date: str) -> Optional[Dict]:
        """Holt detaillierte Feiertagsinformationen"""
        key = f"holiday:detail:{date}"
        data = self.client.hgetall(key)
        
        if data:
            return {
                'date': data['date'],
                'name': data['name'],
                'regional_scope': data['regional_scope'],
                'temporal_scope': data['temporal_scope'],
                'is_nationwide': bool(int(data.get('is_nationwide', 0))),
                'subdivisions': data.get('subdivisions', '')
            }
        return None
    
    def is_holiday(self, date: str) -> bool:
        """Prüft ob Feiertag"""
        return self.client.sismember('holidays:all', date)
    
    def is_nationwide_holiday(self, date: str) -> bool:
        """Prüft ob bundesweiter Feiertag"""
        return self.client.sismember('holidays:nationwide', date)
    
    # ============================================
    # SCHULFERIEN
    # ============================================
    
    def get_school_holiday_info(self, date: str) -> Optional[Dict]:
        """Holt Schulferien-Informationen"""
        key = f"school_holiday:{date}"
        data = self.client.hgetall(key)
        
        if data:
            return {
                'date': data['date'],
                'is_school_holiday': bool(int(data.get('is_school_holiday', 0)))
            }
        return None
    
    def get_school_holiday_period(self, date: str) -> Optional[Dict]:
        """Holt Schulferien-Periode"""
        key = f"school_holiday:day:{date}"
        data = self.client.hgetall(key)
        
        if data:
            return {
                'date': data['date'],
                'holiday_name': data['holiday_name'],
                'start_date': data['start_date'],
                'end_date': data['end_date'],
                'type': data['type']
            }
        return None
    
    def is_school_holiday(self, date: str) -> bool:
        """Prüft ob Schulferien"""
        return self.client.sismember('school_holidays:all', date)
    
    def get_all_school_holiday_periods(self) -> List[Dict]:
        """Holt alle Schulferien-Perioden"""
        pattern = "school_holiday:period:*"
        keys = self.client.keys(pattern)
        
        periods = []
        for key in keys:
            data = self.client.hgetall(key)
            if data:
                periods.append(data)
        
        return sorted(periods, key=lambda x: x.get('start_date', ''))
    
    # ============================================
    # EVENTS
    # ============================================
    
    def get_event_info(self, date: str, hour: int = None) -> Optional[Dict]:
        """Holt Event-Informationen"""
        if hour is not None:
            key = f"event:{date}:{hour}"
            data = self.client.hgetall(key)
            
            if data:
                return {
                    'date': data['date'],
                    'hour': int(data['hour']),
                    'has_event': bool(int(data['has_event'])),
                    'has_concert': bool(int(data['has_concert']))
                }
        else:
            # Ganzer Tag
            has_any_event = False
            has_any_concert = False
            
            for h in range(24):
                key = f"event:{date}:{h}"
                data = self.client.hgetall(key)
                if data:
                    if data.get('has_event') == '1':
                        has_any_event = True
                    if data.get('has_concert') == '1':
                        has_any_concert = True
            
            return {
                'date': date,
                'has_event': has_any_event,
                'has_concert': has_any_concert
            }
        
        return None
    
    def get_detailed_event_info(self, date: str, hour: int = None) -> Optional[Dict]:
        """Holt detaillierte Event-Informationen"""
        if hour is not None:
            key = f"event:detail:hour:{date}:{hour}"
            data = self.client.hgetall(key)
            
            if data:
                return {
                    'date': data['date'],
                    'hour': int(data['hour']),
                    'event_name': data['event_name'],
                    'is_concert': bool(int(data['is_concert'])),
                    'event_start': data['event_start'],
                    'event_end': data['event_end']
                }
        else:
            # Alle Events des Tages
            events = []
            seen_events = set()
            
            for h in range(24):
                key = f"event:detail:hour:{date}:{h}"
                data = self.client.hgetall(key)
                if data and data['event_name'] not in seen_events:
                    events.append({
                        'event_name': data['event_name'],
                        'is_concert': bool(int(data['is_concert'])),
                        'start': data['event_start'],
                        'end': data['event_end']
                    })
                    seen_events.add(data['event_name'])
            
            return {
                'date': date,
                'events': events,
                'has_event': len(events) > 0
            }
        
        return None
    
    def has_event_on_date(self, date: str) -> bool:
        """Prüft ob Event an diesem Tag"""
        return self.client.sismember('events:all_dates', date)
    
    # ============================================
    # VORLESUNGSZEITEN
    # ============================================
    
    def get_lecture_info(self, date: str) -> Optional[Dict]:
        """Read lecture info from Redis matching actual schema."""
        key = f"lecture:daily:{date}"  # Changed from "lecture:{date}"
        data = self.client.hgetall(key)

        if not data:
            return None

        # Return university-specific flags
        university = data.get("university", "")
        is_lecture = int(data.get("is_lecture_period", 0))

        return {
            "date": data.get("date", date),
            "is_lecture_period": is_lecture,
            "jmu_lecture": 1 if (is_lecture and university == "JMU") else 0,
            "thws_lecture": 1 if (is_lecture and university == "THWS") else 0
        }
    
    def is_jmu_lecture_period(self, date: str) -> bool:
        """Prüft ob JMU Vorlesungszeit"""
        return self.client.sismember('lectures:jmu:detailed', date)
    
    def is_thws_lecture_period(self, date: str) -> bool:
        """Prüft ob THWS Vorlesungszeit"""
        return self.client.sismember('lectures:thws:detailed', date)
    
    # ============================================
    # LOCATIONS
    # ============================================
    
    def get_location_by_street(self, street_name: str) -> Optional[Dict]:
        """Holt Standort-Informationen nach Straßenname"""
        key = f"location:name:{street_name}"
        data = self.client.hgetall(key)
        
        if data:
            return {
                'location_id': data['location_id'],
                'street_name': data['street_name'],
                'city': data['city'],
                'latitude': float(data['latitude']),
                'longitude': float(data['longitude']),
                'geo_shape': json.loads(data['geo_shape']) if data.get('geo_shape') else {}
            }
        return None
    
    def get_location_by_id(self, location_id: str) -> Optional[Dict]:
        """Holt Standort-Informationen nach ID"""
        key = f"location:id:{location_id}"
        data = self.client.hgetall(key)
        
        if data:
            return {
                'location_id': data['location_id'],
                'street_name': data['street_name'],
                'city': data['city'],
                'latitude': float(data['latitude']),
                'longitude': float(data['longitude']),
                'geo_shape': json.loads(data['geo_shape']) if data.get('geo_shape') else {}
            }
        return None
    
    def get_all_locations(self) -> List[Dict]:
        """Holt alle Zählstationen"""
        street_names = self.client.smembers('locations:all_streets')
        locations = []
        
        for street in street_names:
            location = self.get_location_by_street(street)
            if location:
                locations.append(location)
        
        return locations

    def _get_range_via_index(self, street: str, start_date: str, end_date: str) -> List[Dict]:
        """Schnelle Methode mit Index"""
        index_key = f"pedestrian:index:{street}"
        start_ts = datetime.fromisoformat(f"{start_date}T00:00:00").timestamp()
        end_ts = datetime.fromisoformat(f"{end_date}T23:59:59").timestamp()
        
        keys = self.client.zrangebyscore(index_key, start_ts, end_ts)
        
        if not keys:
            return []
        
        pipe = self.client.pipeline()
        for key in keys:
            pipe.hgetall(key)
        
        results = pipe.execute()
        return sorted([r for r in results if r], key=lambda x: (x.get('date', ''), int(x.get('hour', 0))))

    def _get_range_via_scan(self, street: str, start_date: str, end_date: str) -> List[Dict]:
        """Fallback mit SCAN"""
        # Wie oben in Optimierung 1
        ...
