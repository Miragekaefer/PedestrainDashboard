# backend/scripts/import_lectures.py
import sys
sys.path.append('/app')

import csv
import redis
from datetime import datetime, timedelta
from typing import List
import config

def import_lectures_to_redis(csv_file_path: str):
    """Importiert Vorlesungszeit-Perioden aus CSV in Redis"""
    
    # Redis Verbindung
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    print(f"Importing lecture periods from {csv_file_path}...")
    
    imported = 0
    total_days = 0
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                start_date = row['start']
                end_date = row['end']
                jmu = row['jmu']
                thws = row['thws']
                
                # Key für Periode
                period_key = f"lecture:period:{start_date}_{end_date}"
                
                period_data = {
                    'start_date': start_date,
                    'end_date': end_date,
                    'jmu': jmu,
                    'thws': thws,
                    'imported_at': datetime.now().isoformat()
                }
                
                r.hset(period_key, mapping=period_data)
                r.expire(period_key, 60*60*24*365*10)
                
                # Generiere alle Tage in der Periode
                dates = generate_date_range(start_date, end_date)
                total_days += len(dates)
                
                # Speichere jeden Tag
                for date in dates:
                    day_key = f"lecture:detail:{date}"
                    
                    # Hole existierende Daten falls vorhanden
                    existing = r.hgetall(day_key)
                    
                    day_data = {
                        'date': date,
                        'jmu_lecture': jmu if jmu == '1' else existing.get('jmu_lecture', '0'),
                        'thws_lecture': thws if thws == '1' else existing.get('thws_lecture', '0'),
                        'jmu_period_start': start_date if jmu == '1' else existing.get('jmu_period_start', ''),
                        'jmu_period_end': end_date if jmu == '1' else existing.get('jmu_period_end', ''),
                        'thws_period_start': start_date if thws == '1' else existing.get('thws_period_start', ''),
                        'thws_period_end': end_date if thws == '1' else existing.get('thws_period_end', '')
                    }
                    
                    r.hset(day_key, mapping=day_data)
                    r.expire(day_key, 60*60*24*365*10)
                
                uni = "JMU" if jmu == '1' else "THWS"
                imported += 1
                print(f"  → {uni}: {start_date} to {end_date} ({len(dates)} days)")
        
        print(f"\n✓ Import completed!")
        print(f"  Lecture periods: {imported}")
        print(f"  Total days: {total_days}")
        
        # Erstelle Indizes
        create_lecture_indexes(r)
        
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

def create_lecture_indexes(r: redis.Redis):
    """Erstellt Indizes für Vorlesungszeiten"""
    print("\nCreating indexes...")
    
    pattern = "lecture:detail:*"
    keys = r.keys(pattern)
    
    jmu_dates = []
    thws_dates = []
    
    for key in keys:
        data = r.hgetall(key)
        date = data['date']
        
        if data.get('jmu_lecture') == '1':
            jmu_dates.append(date)
        if data.get('thws_lecture') == '1':
            thws_dates.append(date)
    
    # Set: JMU Vorlesungstage
    if jmu_dates:
        r.delete('lectures:jmu:detailed')
        r.sadd('lectures:jmu:detailed', *jmu_dates)
        r.expire('lectures:jmu:detailed', 60*60*24*365*10)
        print(f"  → JMU lecture days: {len(jmu_dates)}")
    
    # Set: THWS Vorlesungstage
    if thws_dates:
        r.delete('lectures:thws:detailed')
        r.sadd('lectures:thws:detailed', *thws_dates)
        r.expire('lectures:thws:detailed', 60*60*24*365*10)
        print(f"  → THWS lecture days: {len(thws_dates)}")

if __name__ == "__main__":
    csv_path = "/app/data/lectures.csv"
    import_lectures_to_redis(csv_path)