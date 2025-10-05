# backend/scripts/import_events.py
import sys
sys.path.append('/app')

import csv
import redis
from datetime import datetime
import config

def import_events_to_redis(csv_file_path: str):
    """Importiert Events aus CSV in Redis"""
    
    # Redis Verbindung
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    print(f"Importing events from {csv_file_path}...")
    
    imported = 0
    event_days = 0
    concert_days = 0
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                date_str = row['date']
                event = row['event']
                concert = row['concert']
                
                # Parse datetime
                dt = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S')
                date_only = dt.strftime('%Y-%m-%d')
                hour = dt.hour
                
                # Key: event:YYYY-MM-DD:HH
                key = f"event:{date_only}:{hour}"
                
                data = {
                    'date': date_only,
                    'hour': str(hour),
                    'datetime': date_str,
                    'has_event': event,
                    'has_concert': concert,
                    'imported_at': datetime.now().isoformat()
                }
                
                r.hset(key, mapping=data)
                r.expire(key, 60*60*24*365*5)
                
                if event == '1':
                    event_days += 1
                if concert == '1':
                    concert_days += 1
                
                imported += 1
                
                if imported % 1000 == 0:
                    print(f"  → Imported {imported} records...")
        
        print(f"\n✓ Import completed!")
        print(f"  Total records: {imported}")
        print(f"  Hours with events: {event_days}")
        print(f"  Hours with concerts: {concert_days}")
        
        # Erstelle Indizes
        create_event_indexes(r)
        
    except FileNotFoundError:
        print(f"Error: File {csv_file_path} not found!")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()

def create_event_indexes(r: redis.Redis):
    """Erstellt Indizes für Events"""
    print("\nCreating event indexes...")
    
    pattern = "event:*"
    keys = r.keys(pattern)
    
    event_dates = set()
    concert_dates = set()
    
    for key in keys:
        data = r.hgetall(key)
        date = data['date']
        
        if data.get('has_event') == '1':
            event_dates.add(date)
        if data.get('has_concert') == '1':
            concert_dates.add(date)
    
    # Set: Tage mit Events
    if event_dates:
        r.delete('events:all_dates')
        r.sadd('events:all_dates', *event_dates)
        r.expire('events:all_dates', 60*60*24*365*5)
        print(f"  → Days with events: {len(event_dates)}")
    
    # Set: Tage mit Konzerten
    if concert_dates:
        r.delete('events:concert_dates')
        r.sadd('events:concert_dates', *concert_dates)
        r.expire('events:concert_dates', 60*60*24*365*5)
        print(f"  → Days with concerts: {len(concert_dates)}")

def get_event_info(date: str, hour: int = None) -> dict:
    """Holt Event-Informationen"""
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    if hour is not None:
        # Spezifische Stunde
        key = f"event:{date}:{hour}"
        data = r.hgetall(key)
        
        if data:
            return {
                'date': data['date'],
                'hour': int(data['hour']),
                'has_event': bool(int(data['has_event'])),
                'has_concert': bool(int(data['has_concert']))
            }
    else:
        # Ganzer Tag - prüfe alle 24 Stunden
        has_any_event = False
        has_any_concert = False
        
        for h in range(24):
            key = f"event:{date}:{h}"
            data = r.hgetall(key)
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

if __name__ == "__main__":
    csv_path = "/app/data/events_daily.csv"
    import_events_to_redis(csv_path)
    
    # Test
    print("\n" + "="*60)
    print("Testing event lookup...")
    test_dates = [
        ("2019-01-01", None),
        ("2019-01-01", 0),
        ("2019-01-01", 12)
    ]
    for date, hour in test_dates:
        info = get_event_info(date, hour)
        if info:
            if hour is not None:
                print(f"{date} {hour}:00 - Event: {info['has_event']}, Concert: {info['has_concert']}")
            else:
                print(f"{date} (full day) - Event: {info['has_event']}, Concert: {info['has_concert']}")