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
    # PASSANTENDATEN
    # ============================================
    
    def store_hourly_data(self, street: str, data: Dict):
        """Speichert stündliche Passantendaten"""
        key = f"pedestrian:hourly:{street}:{data['date']}:{data['hour']}"
        self.client.hset(key, mapping=data)
        self.client.expire(key, 60*60*24*730)  # 2 Jahre TTL
    
    def get_hourly_data(self, street: str, date: str, hour: int) -> Optional[Dict]:
        """Holt stündliche Daten"""
        key = f"pedestrian:hourly:{street}:{date}:{hour}"
        data = self.client.hgetall(key)
        return data if data else None
    
    def get_historical_range(self, street: str, start_date: str, end_date: str) -> List[Dict]:
        """Holt historische Daten für einen Zeitraum"""
        pattern = f"pedestrian:hourly:{street}:*"
        keys = self.client.keys(pattern)
        
        results = []
        for key in keys:
            data = self.client.hgetall(key)
            if data and start_date <= data.get('date', '') <= end_date:
                results.append(data)
        
        return sorted(results, key=lambda x: (x.get('date', ''), int(x.get('hour', 0))))
    
    def bulk_store_hourly_data(self, street: str, data_list: List[Dict]):
        """Bulk Insert mit Pipeline"""
        pipe = self.client.pipeline()
        
        for data in data_list:
            key = f"pedestrian:hourly:{street}:{data['date']}:{data['hour']}"
            pipe.hset(key, mapping=data)
            pipe.expire(key, 60*60*24*730)
        
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