# backend/data_ingestion/api_fetcher.py
import time
import requests
from typing import List, Dict, Generator
from datetime import datetime
from database.redis_client import PedestrianRedisClient

class APIFetcher:
    def __init__(self, base_url: str, redis_client: PedestrianRedisClient):
        self.base_url = base_url
        self.redis_client = redis_client
        self.streets = ["Kaiserstraße", "Schönbornstraße", "Spiegelstraße"]
        self.batch_size = 100
    
    # ============================================
    # NUR API-FETCHING LOGIK (keine Redis-Queries!)
    # ============================================
    
    def fetch_all_historical_data(self, year: str = "2025"):
        """Holt ALLE Daten für alle Straßen (initial bulk load)"""
        months = [f"{year}-{str(m).zfill(2)}" for m in range(1, 13)]
        
        for street in self.streets:
            print(f"\nFetching complete history for {street}...")
            total_records = 0
            
            for month in months:
                print(f"  Processing {month}...")
                month_records = 0
                
                for batch in self._paginated_fetch_by_month(street, month):
                    records_stored = self._store_batch(street, batch)
                    month_records += records_stored
                    total_records += records_stored
                    time.sleep(0.1)
                
                print(f"    → {month}: {month_records} records")
            
            print(f"✓ Completed {street}: {total_records} total records\n")
    
    def fetch_latest_updates(self, hours_back: int = 2):
        """Holt nur die neuesten Daten (für stündliche Updates)"""
        for street in self.streets:
            print(f"Fetching latest data for {street}...")
            data = self._fetch_recent(street, hours_back)
            self._store_batch(street, data)
    
    # ============================================
    # PRIVATE: API Calls
    # ============================================
    
    def _paginated_fetch_by_month(self, street: str, year_month: str) -> Generator[List[Dict], None, None]:
        """Generator für paginierte API-Calls pro Monat"""
        offset = 0
        total_count = None
        
        while True:
            response_data = self._fetch_page_by_month(street, year_month, offset)
            
            if total_count is None:
                total_count = response_data.get('total_count', 0)
                if total_count > 0:
                    print(f"      Total for {year_month}: {total_count}")
            
            records = response_data.get('results', [])
            if not records:
                break
            
            yield records
            
            offset += len(records)
            if offset >= total_count or offset >= 10000:
                break
    
    def _fetch_page_by_month(self, street: str, year_month: str, offset: int) -> Dict:
        """Einzelner API Call mit Pagination"""
        url = f"{self.base_url}/api/explore/v2.1/catalog/datasets/passantenzaehlung_stundendaten/records"
        
        params = {
            "limit": self.batch_size,
            "offset": offset,
            "refine": [
                f"timestamp:{year_month}",
                f"location_name:{street}"
            ]
        }
        
        try:
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            print(f"      Error at offset {offset}: {e}")
            return {"results": [], "total_count": 0}
    
    def _fetch_recent(self, street: str, hours_back: int) -> List[Dict]:
        """Holt nur die neuesten Daten"""
        url = f"{self.base_url}/api/explore/v2.1/catalog/datasets/passantenzaehlung_stundendaten/records"
        
        params = {
            "limit": hours_back * 2,
            "refine": f"location_name:{street}",
            "order_by": "timestamp DESC"
        }
        
        try:
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            return response.json().get('results', [])
        except requests.RequestException as e:
            print(f"Error fetching recent data: {e}")
            return []
    
    # ============================================
    # PRIVATE: Daten-Transformation & Speicherung
    # ============================================
    
    def _store_batch(self, street: str, records: List[Dict]) -> int:
        """Speichert einen Batch von Records in Redis"""
        stored = 0
        for record in records:
            try:
                data = self._transform_record(street, record)
                self.redis_client.store_hourly_data(street, data)
                stored += 1
            except Exception as e:
                print(f"Error storing record: {e}")
        return stored
    
    def _transform_record(self, street: str, record: Dict) -> Dict:
        """Transformiert API-Format in Redis-Format"""
        timestamp = record.get('timestamp', '')
        dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        
        def safe_str(value, default=''):
            return str(value) if value is not None else default
        
        return {
            'id': f"{street}_{dt.strftime('%Y-%m-%d_%H')}",
            'street': street,
            'city': 'Wuerzburg',
            'date': dt.strftime('%Y-%m-%d'),
            'hour': str(dt.hour),
            'weekday': dt.strftime('%A'),
            'n_pedestrians': safe_str(record.get('pedestrians_count', 0)),
            'n_pedestrians_towards': safe_str(record.get('details_ltr_pedestrians_count', 0)),
            'n_pedestrians_away': safe_str(record.get('details_rtl_pedestrians_count', 0)),
            'temperature': safe_str(record.get('temperature')),
            'weather_condition': safe_str(record.get('weather_condition')),
            'incidents': 'verified' if record.get('unverified') == 0 else 'unverified',
            'collection_type': 'measured',
            'timestamp': timestamp
        }