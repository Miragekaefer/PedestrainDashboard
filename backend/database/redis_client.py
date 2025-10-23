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
        """Holt alle Events mit Format {date, hour, datatime, event, concert}"""
        events = []
        
        # Alle Event-Keys mit Pattern-Matching finden
        pattern = "event:*:*"
        keys = self.client.keys(pattern)
        
        for key in keys:
            # Key-Format: event:YYYY-MM-DD:HH
            parts = key.split(':')
            if len(parts) == 3 and parts[0] == 'event':
                data = self.client.hgetall(key)
                
                if data:
                    events.append({
                        'date': data.get('date', parts[1]),
                        'hour': int(data.get('hour', parts[2])),
                        "datetime": data.get('datetime'),
                        'event': bool(int(data.get('has_event', 0))),
                        'concert': bool(int(data.get('has_concert', 0)))
                    })
        
        # Nach Datum und Stunde sortieren
        events.sort(key=lambda x: (x['date'], x['hour']))
        return events

    # ============================================
    # ALL LECTURES (FOR MODEL TRAINING)
    # ============================================

    def get_all_lecture_dates(self) -> List[str]:
        """Return all dates that are within lecture periods"""
        return list(self.client.smembers('lectures:all_dates') or [])

    def get_all_lectures(self) -> List[Dict]:
        """Return all lecture periods for all dates"""
        all_dates = self.get_all_lecture_dates()
        results = []

        for date_str in all_dates:
            info = self.get_lecture_info(date_str) or {}
            results.append({
                "date": date_str,
                "is_lecture_period": int(info.get("jmu_lecture", 0))
            })
        
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
    
    def store_prediction(self, street: str, date: str, hour: int, prediction: Dict):
        """Speichert Vorhersage"""
        key = f"prediction:{street}:{date}:{hour}"
        self.client.hset(key, mapping=prediction)
        self.client.expire(key, 60*60*24*30)  # 30 Tage TTL
    
    def get_predictions(self, street: str, hours_ahead: int = 168) -> List[Dict]:
        """Holt Vorhersagen für die nächsten X Stunden"""
        now = datetime.now()
        results = []
        
        for i in range(hours_ahead):
            future = now + timedelta(hours=i)
            key = f"prediction:{street}:{future.date()}:{future.hour}"
            data = self.client.hgetall(key)
            if data:
                data['datetime'] = future.isoformat()
                results.append(data)
        
        return results
    
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
        """Holt Vorlesungszeit-Informationen"""
        key = f"lecture:detail:{date}"
        data = self.client.hgetall(key)
        
        if data:
            return {
                'date': data['date'],
                'jmu_lecture': bool(int(data.get('jmu_lecture', 0))),
                'thws_lecture': bool(int(data.get('thws_lecture', 0))),
                'jmu_period': {
                    'start': data.get('jmu_period_start'),
                    'end': data.get('jmu_period_end')
                } if data.get('jmu_lecture') == '1' else None,
                'thws_period': {
                    'start': data.get('thws_period_start'),
                    'end': data.get('thws_period_end')
                } if data.get('thws_lecture') == '1' else None
            }
        return None
    
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
