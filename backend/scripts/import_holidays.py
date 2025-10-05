# backend/scripts/import_holidays.py
import sys
sys.path.append('/app')

import csv
import redis
from datetime import datetime
import config

def import_holidays_to_redis(csv_file_path: str):
    """Importiert Feiertage aus CSV in Redis"""
    
    # Redis Verbindung
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    print(f"Importing holidays from {csv_file_path}...")
    
    imported = 0
    skipped = 0
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                date = row['date']
                public_holiday = row['public_holiday']
                nationwide = row['nationwide']
                
                # Key-Struktur: holiday:YYYY-MM-DD
                key = f"holiday:{date}"
                
                # Daten als Hash speichern
                data = {
                    'date': date,
                    'is_holiday': public_holiday,
                    'is_nationwide': nationwide,
                    'imported_at': datetime.now().isoformat()
                }
                
                r.hset(key, mapping=data)
                # TTL: 5 Jahre
                r.expire(key, 60*60*24*365*5)
                
                imported += 1
                
                if imported % 100 == 0:
                    print(f"  → Imported {imported} records...")
        
        print(f"\n✓ Import completed!")
        print(f"  Total imported: {imported}")
        print(f"  Skipped: {skipped}")
        
        # Erstelle zusätzlichen Index für schnelle Abfragen
        create_holiday_index(r)
        
    except FileNotFoundError:
        print(f"Error: File {csv_file_path} not found!")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()

def create_holiday_index(r: redis.Redis):
    """Erstellt Set mit allen Feiertags-Daten für schnelle Abfragen"""
    print("\nCreating holiday index...")
    
    # Set mit allen Feiertagen
    pattern = "holiday:*"
    keys = r.keys(pattern)
    
    holidays = []
    for key in keys:
        data = r.hgetall(key)
        if data.get('is_holiday') == '1':
            holidays.append(data['date'])
    
    if holidays:
        # Set: Alle Feiertage
        r.delete('holidays:all')
        r.sadd('holidays:all', *holidays)
        r.expire('holidays:all', 60*60*24*365*5)
        print(f"  → Added {len(holidays)} holidays to index")

def get_holiday_info(date: str) -> dict:
    """Hilfsfunktion zum Abrufen von Feiertagsinfos"""
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    key = f"holiday:{date}"
    data = r.hgetall(key)
    
    if data:
        return {
            'date': data['date'],
            'is_holiday': bool(int(data['is_holiday'])),
            'is_nationwide': bool(int(data['is_nationwide']))
        }
    return None

if __name__ == "__main__":
    # CSV Pfad anpassen
    csv_path = "/app/data/bavarian_public_holidays_daily.csv"
    import_holidays_to_redis(csv_path)
    
    # Test
    print("\n" + "="*60)
    print("Testing holiday lookup...")
    test_dates = ["2019-01-01", "2019-01-02"]
    for date in test_dates:
        info = get_holiday_info(date)
        if info:
            print(f"{date}: Holiday={info['is_holiday']}, Nationwide={info['is_nationwide']}")
        else:
            print(f"{date}: No data found")