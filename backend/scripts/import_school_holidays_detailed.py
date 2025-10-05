# backend/scripts/import_school_holidays_detailed.py
import sys
sys.path.append('/app')

import csv
import redis
from datetime import datetime, timedelta
from typing import List
import config

def import_detailed_school_holidays_to_redis(csv_file_path: str):
    """Importiert detaillierte Schulferien aus CSV in Redis"""
    
    # Redis Verbindung
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    print(f"Importing detailed school holidays from {csv_file_path}...")
    
    imported = 0
    total_days = 0
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                name = row['name']
                start_date = row['startDate']
                end_date = row['endDate']
                holiday_type = row['type'].lower()
                subdivisions = row['subdivisions']
                
                # Key für die Ferienperiode
                key = f"school_holiday:period:{start_date}_{end_date}"
                
                data = {
                    'name': name,
                    'start_date': start_date,
                    'end_date': end_date,
                    'type': holiday_type,
                    'subdivisions': subdivisions,
                    'imported_at': datetime.now().isoformat()
                }
                
                r.hset(key, mapping=data)
                r.expire(key, 60*60*24*365*5)
                
                # Berechne und speichere auch einzelne Tage
                days = generate_date_range(start_date, end_date)
                total_days += len(days)
                
                # Speichere jeden einzelnen Tag mit Referenz zur Periode
                for day in days:
                    day_key = f"school_holiday:day:{day}"
                    day_data = {
                        'date': day,
                        'holiday_name': name,
                        'start_date': start_date,
                        'end_date': end_date,
                        'type': holiday_type
                    }
                    r.hset(day_key, mapping=day_data)
                    r.expire(day_key, 60*60*24*365*5)
                
                imported += 1
                print(f"  → {name}: {start_date} to {end_date} ({len(days)} days)")
        
        print(f"\n✓ Import completed!")
        print(f"  Holiday periods: {imported}")
        print(f"  Total holiday days: {total_days}")
        
        # Erstelle Indizes
        create_detailed_school_holiday_indexes(r)
        
    except FileNotFoundError:
        print(f"Error: File {csv_file_path} not found!")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()

def generate_date_range(start_date: str, end_date: str) -> List[str]:
    """Generiert alle Daten zwischen Start und Ende"""
    start = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.strptime(end_date, '%Y-%m-%d')
    
    dates = []
    current = start
    while current <= end:
        dates.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=1)
    
    return dates

def create_detailed_school_holiday_indexes(r: redis.Redis):
    """Erstellt Indizes für schnelle Abfragen"""
    print("\nCreating indexes...")
    
    # Index: Alle Ferientage
    pattern = "school_holiday:day:*"
    keys = r.keys(pattern)
    
    all_days = []
    by_name = {}
    
    for key in keys:
        data = r.hgetall(key)
        date = data['date']
        name = data['holiday_name']
        
        all_days.append(date)
        
        if name not in by_name:
            by_name[name] = []
        by_name[name].append(date)
    
    # Set: Alle Schulferien-Tage
    if all_days:
        r.delete('school_holidays:detailed:all')
        r.sadd('school_holidays:detailed:all', *all_days)
        r.expire('school_holidays:detailed:all', 60*60*24*365*5)
        print(f"  → All school holiday days: {len(all_days)}")
    
    # Sets: Nach Ferienname
    for name, dates in by_name.items():
        key = f"school_holidays:by_name:{name}"
        r.delete(key)
        r.sadd(key, *dates)
        r.expire(key, 60*60*24*365*5)
    print(f"  → Indexed {len(by_name)} different holiday periods")
    
    # Liste aller Ferienperioden
    pattern = "school_holiday:period:*"
    periods = r.keys(pattern)
    if periods:
        r.delete('school_holidays:periods')
        r.sadd('school_holidays:periods', *periods)
        r.expire('school_holidays:periods', 60*60*24*365*5)
        print(f"  → Holiday periods: {len(periods)}")

def get_school_holiday_period(date: str) -> dict:
    """Gibt die Ferienperiode für ein Datum zurück"""
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    key = f"school_holiday:day:{date}"
    data = r.hgetall(key)
    
    if data:
        return {
            'date': data['date'],
            'holiday_name': data['holiday_name'],
            'start_date': data['start_date'],
            'end_date': data['end_date'],
            'type': data['type']
        }
    return None

if __name__ == "__main__":
    csv_path = "/app/data/bavarian_school_holidays.csv"
    import_detailed_school_holidays_to_redis(csv_path)
    
    # Test
    print("\n" + "="*60)
    print("Testing detailed school holiday lookup...")
    test_dates = ["2019-01-01", "2019-03-05", "2019-07-30"]
    for date in test_dates:
        info = get_school_holiday_period(date)
        if info:
            print(f"{date}: {info['holiday_name']} ({info['start_date']} - {info['end_date']})")
        else:
            print(f"{date}: No school holiday")