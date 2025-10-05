# backend/scripts/import_holidays_detailed.py
import sys
sys.path.append('/app')

import csv
import redis
from datetime import datetime
import config

def import_detailed_holidays_to_redis(csv_file_path: str):
    """Importiert detaillierte Feiertage aus CSV in Redis"""
    
    # Redis Verbindung
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    print(f"Importing detailed holidays from {csv_file_path}...")
    
    imported = 0
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                date = row['date']
                name = row['name']
                regional_scope = row['regionalScope']
                temporal_scope = row['temporalScope']
                nationwide = row['nationwide']
                subdivisions = row['subdivisions']
                
                # Key-Struktur: holiday:detail:YYYY-MM-DD
                key = f"holiday:detail:{date}"
                
                # Vollständige Daten als Hash speichern
                data = {
                    'date': date,
                    'name': name,
                    'regional_scope': regional_scope,
                    'temporal_scope': temporal_scope,
                    'is_nationwide': nationwide,
                    'subdivisions': subdivisions,
                    'imported_at': datetime.now().isoformat()
                }
                
                r.hset(key, mapping=data)
                # TTL: 5 Jahre
                r.expire(key, 60*60*24*365*5)
                
                imported += 1
                
                if imported % 50 == 0:
                    print(f"  → Imported {imported} records...")
        
        print(f"\n✓ Import completed!")
        print(f"  Total imported: {imported}")
        
        # Erstelle verschiedene Indizes
        create_detailed_indexes(r)
        
    except FileNotFoundError:
        print(f"Error: File {csv_file_path} not found!")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()

def create_detailed_indexes(r: redis.Redis):
    """Erstellt verschiedene Indizes für schnelle Abfragen"""
    print("\nCreating indexes...")
    
    pattern = "holiday:detail:*"
    keys = r.keys(pattern)
    
    nationwide_holidays = []
    regional_holidays = []
    holiday_names = {}
    
    for key in keys:
        data = r.hgetall(key)
        date = data['date']
        name = data['name']
        
        # Index: Bundesweite Feiertage
        if data.get('is_nationwide') == '1':
            nationwide_holidays.append(date)
        else:
            regional_holidays.append(date)
        
        # Index: Nach Namen
        if name not in holiday_names:
            holiday_names[name] = []
        holiday_names[name].append(date)
    
    # Set: Bundesweite Feiertage
    if nationwide_holidays:
        r.delete('holidays:nationwide')
        r.sadd('holidays:nationwide', *nationwide_holidays)
        r.expire('holidays:nationwide', 60*60*24*365*5)
        print(f"  → Nationwide holidays: {len(nationwide_holidays)}")
    
    # Set: Regionale Feiertage (Bayern)
    if regional_holidays:
        r.delete('holidays:regional')
        r.sadd('holidays:regional', *regional_holidays)
        r.expire('holidays:regional', 60*60*24*365*5)
        print(f"  → Regional holidays: {len(regional_holidays)}")
    
    # Hash: Feiertage nach Namen
    for name, dates in holiday_names.items():
        key = f"holidays:by_name:{name}"
        r.delete(key)
        r.sadd(key, *dates)
        r.expire(key, 60*60*24*365*5)
    print(f"  → Indexed {len(holiday_names)} different holiday names")

def get_detailed_holiday_info(date: str) -> dict:
    """Hilfsfunktion zum Abrufen detaillierter Feiertagsinfos"""
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    key = f"holiday:detail:{date}"
    data = r.hgetall(key)
    
    if data:
        return {
            'date': data['date'],
            'name': data['name'],
            'regional_scope': data['regional_scope'],
            'temporal_scope': data['temporal_scope'],
            'is_nationwide': bool(int(data['is_nationwide'])),
            'subdivisions': data['subdivisions']
        }
    return None

if __name__ == "__main__":
    # CSV Pfad
    csv_path = "/app/data/bavarian_public_holidays.csv"
    import_detailed_holidays_to_redis(csv_path)
    
    # Test
    print("\n" + "="*60)
    print("Testing detailed holiday lookup...")
    test_dates = ["2019-01-01", "2019-01-06", "2019-04-19"]
    for date in test_dates:
        info = get_detailed_holiday_info(date)
        if info:
            print(f"{date}: {info['name']} (Nationwide: {info['is_nationwide']})")
        else:
            print(f"{date}: No data found")