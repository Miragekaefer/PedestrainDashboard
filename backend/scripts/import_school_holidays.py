# backend/scripts/import_school_holidays.py
import sys
sys.path.append('/app')

import csv
import redis
from datetime import datetime
import config

def import_school_holidays_to_redis(csv_file_path: str):
    """Importiert Schulferien aus CSV in Redis"""
    
    # Redis Verbindung
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    print(f"Importing school holidays from {csv_file_path}...")
    
    imported = 0
    holiday_count = 0
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                date = row['date']
                school_holiday = row['school_holiday']
                
                # Key-Struktur: school_holiday:YYYY-MM-DD
                key = f"school_holiday:{date}"
                
                data = {
                    'date': date,
                    'is_school_holiday': school_holiday,
                    'imported_at': datetime.now().isoformat()
                }
                
                r.hset(key, mapping=data)
                # TTL: 5 Jahre
                r.expire(key, 60*60*24*365*5)
                
                imported += 1
                if school_holiday == '1':
                    holiday_count += 1
                
                if imported % 100 == 0:
                    print(f"  → Imported {imported} records...")
        
        print(f"\n✓ Import completed!")
        print(f"  Total imported: {imported}")
        print(f"  School holiday days: {holiday_count}")
        
        # Erstelle Index
        create_school_holiday_index(r)
        
    except FileNotFoundError:
        print(f"Error: File {csv_file_path} not found!")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()

def create_school_holiday_index(r: redis.Redis):
    """Erstellt Set mit allen Schulferien-Daten"""
    print("\nCreating school holiday index...")
    
    pattern = "school_holiday:*"
    keys = r.keys(pattern)
    
    school_holidays = []
    for key in keys:
        data = r.hgetall(key)
        if data.get('is_school_holiday') == '1':
            school_holidays.append(data['date'])
    
    if school_holidays:
        r.delete('school_holidays:all')
        r.sadd('school_holidays:all', *school_holidays)
        r.expire('school_holidays:all', 60*60*24*365*5)
        print(f"  → Added {len(school_holidays)} school holiday days to index")

def get_school_holiday_info(date: str) -> dict:
    """Hilfsfunktion zum Abrufen von Schulferien-Infos"""
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    key = f"school_holiday:{date}"
    data = r.hgetall(key)
    
    if data:
        return {
            'date': data['date'],
            'is_school_holiday': bool(int(data['is_school_holiday']))
        }
    return None

if __name__ == "__main__":
    csv_path = "/app/data/bavarian_school_holidays_daily.csv"
    import_school_holidays_to_redis(csv_path)
    
    # Test
    print("\n" + "="*60)
    print("Testing school holiday lookup...")
    test_dates = ["2019-01-01", "2019-01-05", "2019-01-06"]
    for date in test_dates:
        info = get_school_holiday_info(date)
        if info:
            print(f"{date}: School holiday={info['is_school_holiday']}")
        else:
            print(f"{date}: No data found")