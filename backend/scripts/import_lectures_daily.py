# backend/scripts/import_lectures_daily.py
import sys
sys.path.append('/app')

import csv
import redis
from datetime import datetime
import config

def import_lectures_daily_to_redis(csv_file_path: str):
    """Importiert tägliche Vorlesungszeit-Daten aus CSV in Redis"""
    
    # Redis Verbindung
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    print(f"Importing daily lecture periods from {csv_file_path}...")
    
    imported = 0
    lecture_days = 0
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                date = row['date']
                lecture_period = row['lecture_period_jmu']
                
                # Key: lecture:daily:YYYY-MM-DD
                key = f"lecture:daily:{date}"
                
                data = {
                    'date': date,
                    'is_lecture_period': lecture_period,
                    'university': 'JMU',
                    'imported_at': datetime.now().isoformat()
                }
                
                r.hset(key, mapping=data)
                r.expire(key, 60*60*24*365*5)
                
                if lecture_period == '1':
                    lecture_days += 1
                
                imported += 1
                
                if imported % 100 == 0:
                    print(f"  → Imported {imported} records...")
        
        print(f"\n✓ Import completed!")
        print(f"  Total days: {imported}")
        print(f"  Lecture period days: {lecture_days}")
        
        # Erstelle Index
        create_lecture_daily_index(r)
        
    except FileNotFoundError:
        print(f"Error: File {csv_file_path} not found!")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()

def create_lecture_daily_index(r: redis.Redis):
    """Erstellt Index für Vorlesungstage"""
    print("\nCreating lecture period index...")
    
    pattern = "lecture:daily:*"
    keys = r.keys(pattern)
    
    lecture_dates = []
    for key in keys:
        data = r.hgetall(key)
        if data.get('is_lecture_period') == '1':
            lecture_dates.append(data['date'])
    
    if lecture_dates:
        r.delete('lectures:jmu:all_dates')
        r.sadd('lectures:jmu:all_dates', *lecture_dates)
        r.expire('lectures:jmu:all_dates', 60*60*24*365*5)
        print(f"  → JMU lecture days: {len(lecture_dates)}")

if __name__ == "__main__":
    csv_path = "/app/data/lectures_daily.csv"
    import_lectures_daily_to_redis(csv_path)