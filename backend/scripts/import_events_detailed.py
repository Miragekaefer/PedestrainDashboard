# backend/scripts/import_events_detailed.py
import sys
sys.path.append('/app')

import csv
import redis
from datetime import datetime, timedelta
from typing import List
import config

def import_detailed_events_to_redis(csv_file_path: str):
    """Importiert detaillierte Events mit Zeiträumen aus CSV in Redis"""
    
    # Redis Verbindung
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    print(f"Importing detailed events from {csv_file_path}...")
    
    imported = 0
    total_hours = 0
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                name = row['name'].strip()
                start_str = row['start']
                end_str = row['end']
                is_concert = row['concert']
                
                # Parse datetime
                start_dt = datetime.strptime(start_str, '%Y-%m-%d %H:%M:%S')
                end_dt = datetime.strptime(end_str, '%Y-%m-%d %H:%M:%S')
                
                # Key für Event-Period
                period_key = f"event:detail:{start_dt.strftime('%Y-%m-%d_%H-%M')}_{end_dt.strftime('%Y-%m-%d_%H-%M')}"
                
                period_data = {
                    'name': name,
                    'start': start_str,
                    'end': end_str,
                    'is_concert': is_concert,
                    'imported_at': datetime.now().isoformat()
                }
                
                r.hset(period_key, mapping=period_data)
                r.expire(period_key, 60*60*24*365*5)
                
                # Generiere alle betroffenen Stunden und Tage
                hours = generate_datetime_range(start_dt, end_dt)
                total_hours += len(hours)
                
                # Speichere für jede betroffene Stunde
                for hour_dt in hours:
                    date = hour_dt.strftime('%Y-%m-%d')
                    hour = hour_dt.hour
                    
                    hour_key = f"event:detail:hour:{date}:{hour}"
                    hour_data = {
                        'date': date,
                        'hour': str(hour),
                        'event_name': name,
                        'is_concert': is_concert,
                        'event_start': start_str,
                        'event_end': end_str
                    }
                    
                    r.hset(hour_key, mapping=hour_data)
                    r.expire(hour_key, 60*60*24*365*5)
                
                imported += 1
                duration = (end_dt - start_dt).total_seconds() / 3600
                print(f"  → {name}: {start_dt.date()} ({duration:.1f}h)")
        
        print(f"\n✓ Import completed!")
        print(f"  Event periods: {imported}")
        print(f"  Total affected hours: {total_hours}")
        
        # Erstelle Indizes
        create_detailed_event_indexes(r)
        
    except FileNotFoundError:
        print(f"Error: File {csv_file_path} not found!")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()

def generate_datetime_range(start_dt: datetime, end_dt: datetime) -> List[datetime]:
    """Generiert alle Stunden zwischen Start und Ende"""
    hours = []
    current = start_dt.replace(minute=0, second=0, microsecond=0)
    end = end_dt.replace(minute=0, second=0, microsecond=0)
    
    while current <= end:
        hours.append(current)
        current += timedelta(hours=1)
    
    return hours

def create_detailed_event_indexes(r: redis.Redis):
    """Erstellt Indizes für detaillierte Events"""
    print("\nCreating indexes...")
    
    # Alle Event-Stunden
    pattern = "event:detail:hour:*"
    keys = r.keys(pattern)
    
    event_dates = set()
    concert_dates = set()
    event_names = {}
    
    for key in keys:
        data = r.hgetall(key)
        date = data['date']
        name = data['event_name']
        
        event_dates.add(date)
        
        if data.get('is_concert') == '1':
            concert_dates.add(date)
        
        if name not in event_names:
            event_names[name] = set()
        event_names[name].add(date)
    
    # Set: Alle Event-Tage
    if event_dates:
        r.delete('events:detailed:all_dates')
        r.sadd('events:detailed:all_dates', *event_dates)
        r.expire('events:detailed:all_dates', 60*60*24*365*5)
        print(f"  → Days with events: {len(event_dates)}")
    
    # Set: Konzert-Tage
    if concert_dates:
        r.delete('events:detailed:concert_dates')
        r.sadd('events:detailed:concert_dates', *concert_dates)
        r.expire('events:detailed:concert_dates', 60*60*24*365*5)
        print(f"  → Days with concerts: {len(concert_dates)}")
    
    # Sets: Nach Event-Name
    for name, dates in event_names.items():
        safe_name = name.replace(' ', '_').replace(',', '')
        key = f"events:by_name:{safe_name}"
        r.delete(key)
        r.sadd(key, *dates)
        r.expire(key, 60*60*24*365*5)
    print(f"  → Indexed {len(event_names)} different events")

def get_detailed_event_info(date: str, hour: int = None) -> dict:
    """Holt detaillierte Event-Informationen"""
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    if hour is not None:
        key = f"event:detail:hour:{date}:{hour}"
        data = r.hgetall(key)
        
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
        for h in range(24):
            key = f"event:detail:hour:{date}:{h}"
            data = r.hgetall(key)
            if data:
                event_info = {
                    'hour': h,
                    'event_name': data['event_name'],
                    'is_concert': bool(int(data['is_concert']))
                }
                # Nur einzigartige Events
                if not any(e['event_name'] == event_info['event_name'] for e in events):
                    events.append(event_info)
        
        return {
            'date': date,
            'events': events,
            'has_event': len(events) > 0
        }
    
    return None

if __name__ == "__main__":
    csv_path = "/app/data/events.csv"
    import_detailed_events_to_redis(csv_path)
    
    # Test
    print("\n" + "="*60)
    print("Testing detailed event lookup...")
    
    test_cases = [
        ("2019-03-03", None),
        ("2019-03-03", 15),
        ("2019-04-01", None),
        ("2019-05-24", 18)
    ]
    
    for date, hour in test_cases:
        info = get_detailed_event_info(date, hour)
        if info:
            if hour is not None:
                print(f"{date} {hour}:00 - {info.get('event_name', 'No event')}")
            else:
                print(f"{date} - {len(info.get('events', []))} event(s)")