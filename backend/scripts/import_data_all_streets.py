# backend/scripts/import_data_all_streets.py
import sys
sys.path.append('/app')

import csv
import redis
from datetime import datetime
import config

def import_data_all_streets_to_redis(csv_file_path: str):
    """
    Importiert Daten aus dataAllStreets.csv in die bestehende Struktur.
    Überspringt bereits vorhandene Datensätze.
    """
    
    # Redis Verbindung
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    print(f"Importing data from {csv_file_path}...")
    
    imported = 0
    skipped_existing = 0
    skipped_errors = 0
    
    # Mapping für Straßennamen (Normalisierung)
    street_mapping = {
        'Schoenbornstrasse': 'Schönbornstraße',
        'Spiegelstrasse': 'Spiegelstraße',
        'Kaiserstrasse': 'Kaiserstraße'
    }
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f, delimiter=';')
            
            for row in reader:
                try:
                    # Extrahiere Basisdaten
                    street_raw = row['streetname'].strip()
                    street = street_mapping.get(street_raw, street_raw)
                    date = row['date']
                    hour = row['hour']
                    
                    # Key prüfen ob bereits vorhanden
                    key = f"pedestrian:hourly:{street}:{date}:{hour}"
                    
                    if r.exists(key):
                        skipped_existing += 1
                        continue
                    
                    # Daten im BESTEHENDEN Format (wie von API)
                    data = {
                        'id': row['id'],
                        'street': street,
                        'city': row['city'].strip(),
                        'date': date,
                        'hour': str(hour),
                        'weekday': row.get('weekday', ''),
                        
                        # Hauptzählungen - mapping zu API-Struktur
                        'n_pedestrians': row.get('pedestrians_count', '0'),
                        'n_pedestrians_towards': row.get('towards_citycenter_pedestrians_count', '0'),
                        'n_pedestrians_away': row.get('awayfrom_citycenter_pedestrians_count', '0'),
                        
                        # Wetter & Metadata
                        'temperature': row.get('temperature', ''),
                        'weather_condition': row.get('weather_condition', ''),
                        'incidents': row.get('incidents', 'no_incident'),
                        'collection_type': row.get('collection_type', 'measured'),
                        'timestamp': f"{date}T{hour.zfill(2)}:00:00+02:00"
                    }
                    
                    # Entferne leere Werte
                    data = {k: v for k, v in data.items() if v}
                    
                    # Speichere in bestehender Struktur
                    r.hset(key, mapping=data)
                    r.expire(key, 60*60*24*730)  # 2 Jahre TTL
                    
                    imported += 1
                    
                    if imported % 1000 == 0:
                        print(f"  → Imported {imported} new records (skipped {skipped_existing} existing)...")
                
                except Exception as e:
                    skipped_errors += 1
                    if skipped_errors < 10:  # Nur erste 10 Fehler anzeigen
                        print(f"  Warning: Error in row {row.get('id', 'unknown')}: {e}")
        
        print(f"\n✓ Import completed!")
        print(f"  New records imported: {imported}")
        print(f"  Already existing (skipped): {skipped_existing}")
        print(f"  Errors (skipped): {skipped_errors}")
        print(f"  Total processed: {imported + skipped_existing + skipped_errors}")
        
        # Zeige Statistik pro Straße
        show_statistics(r)
        
    except FileNotFoundError:
        print(f"Error: File {csv_file_path} not found!")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()

def show_statistics(r: redis.Redis):
    """Zeigt Statistiken nach dem Import"""
    print("\n" + "="*60)
    print("Statistics per street:")
    print("="*60)
    
    for street in ['Schönbornstraße', 'Spiegelstraße', 'Kaiserstraße']:
        pattern = f"pedestrian:hourly:{street}:*"
        count = 0
        
        # Zähle Keys
        for _ in r.scan_iter(match=pattern, count=1000):
            count += 1
        
        print(f"{street:20s}: {count:,} records")
    
    # Zeige ein Beispiel-Record
    print("\n" + "="*60)
    print("Sample record structure:")
    print("="*60)
    
    test_key = "pedestrian:hourly:Schönbornstraße:2019-04-02:18"
    if r.exists(test_key):
        data = r.hgetall(test_key)
        for key, value in sorted(data.items()):
            print(f"  {key:30s}: {value}")
    else:
        # Finde irgendeinen Key als Beispiel
        pattern = "pedestrian:hourly:*"
        for key in r.scan_iter(match=pattern, count=1):
            data = r.hgetall(key)
            print(f"Key: {key}")
            for k, v in sorted(data.items()):
                print(f"  {k:30s}: {v}")
            break

if __name__ == "__main__":
    csv_path = "/app/data/dataAllStreets.csv"
    import_data_all_streets_to_redis(csv_path)