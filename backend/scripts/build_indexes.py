# backend/scripts/build_indexes.py
import sys
sys.path.append('/app')

import redis
from datetime import datetime
import config

def build_sorted_set_indexes(streets: list[str] | None = None):
    """Erstellt Indizes für alle bestehenden Daten.

    Wenn ``streets`` nicht angegeben ist, werden alle Straßen dynamisch aus den
    vorhandenen Keys in Redis ermittelt (Pattern ``pedestrian:hourly:*``).
    """
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        decode_responses=True
    )

    # Dynamische Ermittlung aller vorhandenen Straßen falls nicht übergeben
    if streets is None:
        discovered_streets = set()
        cursor = 0
        pattern = "pedestrian:hourly:*"
        while True:
            cursor, keys = r.scan(cursor=cursor, match=pattern, count=1000)
            for key in keys:
                parts = key.split(":")
                # Format: pedestrian:hourly:{street}:{date}:{hour}
                if len(parts) >= 5:
                    discovered_streets.add(parts[2])
            if cursor == 0:
                break
        streets = sorted(discovered_streets)

    print("="*70)
    print("Building Sorted Set Indexes for Historical Data")
    print("="*70)

    for street in streets:
        print(f"\nProcessing {street}...")
        pattern = f"pedestrian:hourly:{street}:*"
        index_key = f"pedestrian:index:{street}"
        
        # Lösche alten Index falls vorhanden
        r.delete(index_key)
        
        count = 0
        cursor = 0
        
        while True:
            cursor, keys = r.scan(cursor=cursor, match=pattern, count=1000)
            
            if keys:
                pipe = r.pipeline()
                
                for key in keys:
                    # Extrahiere Datum und Stunde aus Key
                    # Format: pedestrian:hourly:Kaiserstraße:2019-04-02:18
                    parts = key.split(':')
                    if len(parts) >= 5:
                        date = parts[3]
                        hour = parts[4]
                        
                        try:
                            timestamp = f"{date}T{hour.zfill(2)}:00:00"
                            score = datetime.fromisoformat(timestamp).timestamp()
                            pipe.zadd(index_key, {key: score})
                        except Exception as e:
                            print(f"  Warning: Could not index {key}: {e}")
                
                pipe.expire(index_key, 60*60*24*730)
                pipe.execute()
                
                count += len(keys)
                print(f"  → Indexed {count} records...")
            
            if cursor == 0:
                break
        
        print(f"✓ Completed {street}: {count} total records indexed")
        
        # Verify
        index_size = r.zcard(index_key)
        print(f"  Index size: {index_size} entries")
    
    print("\n" + "="*70)
    print("Index building completed!")
    print("="*70)

if __name__ == "__main__":
    build_sorted_set_indexes()