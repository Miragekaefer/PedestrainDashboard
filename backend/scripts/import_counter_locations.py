# backend/scripts/import_counter_locations.py
import sys
sys.path.append('/app')

import csv
import redis
import json
from datetime import datetime
import config

def import_counter_locations_to_redis(csv_file_path: str):
    """Importiert Zählstationen-Geodaten aus CSV in Redis"""
    
    # Redis Verbindung
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    print(f"Importing counter locations from {csv_file_path}...")
    
    imported = 0
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8-sig') as f:  # utf-8-sig entfernt BOM
            reader = csv.DictReader(f, delimiter=';')
            
            # Debug: Print column names
            print(f"CSV Columns: {reader.fieldnames}")
            
            for row in reader:
                # Flexible key access - handle BOM or encoding issues
                location_id = None
                street_name = None
                city = None
                geo_shape_str = None
                geo_point_str = None
                
                # Find correct column names (case insensitive, trimmed)
                for key, value in row.items():
                    key_clean = key.strip().lower()
                    if 'zählstation' in key_clean or 'id' in key_clean:
                        location_id = value
                    elif 'straßenname' in key_clean or 'strasse' in key_clean:
                        street_name = value
                    elif 'stadt' in key_clean or 'city' in key_clean:
                        city = value
                    elif 'geoshape' in key_clean or 'shape' in key_clean:
                        geo_shape_str = value
                    elif 'geopunkt' in key_clean or 'punkt' in key_clean:
                        geo_point_str = value
                
                if not all([location_id, street_name, city]):
                    print(f"  Warning: Skipping row with missing data: {row}")
                    continue
                
                # Parse GeoShape JSON
                try:
                    geo_shape_clean = geo_shape_str.replace('""', '"').strip('"')
                    geo_shape = json.loads(geo_shape_clean)
                except (json.JSONDecodeError, AttributeError) as e:
                    print(f"  Warning: Could not parse GeoShape for {street_name}: {e}")
                    geo_shape = {}
                
                # Parse GeoPunkt
                try:
                    lat_str, lon_str = geo_point_str.split(',')
                    latitude = float(lat_str.strip())
                    longitude = float(lon_str.strip())
                except (ValueError, AttributeError) as e:
                    print(f"  Warning: Could not parse GeoPunkt for {street_name}: {e}")
                    latitude = 0.0
                    longitude = 0.0
                
                # Key: location:id:{location_id}
                key_by_id = f"location:id:{location_id}"
                
                data = {
                    'location_id': location_id,
                    'street_name': street_name,
                    'city': city,
                    'latitude': str(latitude),
                    'longitude': str(longitude),
                    'geo_shape': json.dumps(geo_shape),
                    'imported_at': datetime.now().isoformat()
                }
                
                r.hset(key_by_id, mapping=data)
                r.expire(key_by_id, 60*60*24*365*10)
                
                # Zusätzlicher Key: location:name:{street_name}
                key_by_name = f"location:name:{street_name}"
                r.hset(key_by_name, mapping=data)
                r.expire(key_by_name, 60*60*24*365*10)
                
                imported += 1
                print(f"  → {street_name} (ID: {location_id}): {latitude}, {longitude}")
        
        print(f"\n✓ Import completed!")
        print(f"  Total locations: {imported}")
        
        if imported > 0:
            create_location_indexes(r)
        
    except FileNotFoundError:
        print(f"Error: File {csv_file_path} not found!")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()

def create_location_indexes(r: redis.Redis):
    """Erstellt Indizes für Zählstationen"""
    print("\nCreating location indexes...")
    
    pattern = "location:id:*"
    keys = r.keys(pattern)
    
    location_ids = []
    street_names = []
    
    for key in keys:
        data = r.hgetall(key)
        location_ids.append(data['location_id'])
        street_names.append(data['street_name'])
    
    if location_ids:
        r.delete('locations:all_ids')
        r.sadd('locations:all_ids', *location_ids)
        r.expire('locations:all_ids', 60*60*24*365*10)
        print(f"  → Location IDs: {len(location_ids)}")
    
    if street_names:
        r.delete('locations:all_streets')
        r.sadd('locations:all_streets', *street_names)
        r.expire('locations:all_streets', 60*60*24*365*10)
        print(f"  → Street names: {len(street_names)}")
    
    # Hash-Mapping: Street Name -> Location ID
    mapping_key = "locations:street_to_id"
    for key in keys:
        data = r.hgetall(key)
        r.hset(mapping_key, data['street_name'], data['location_id'])
    r.expire(mapping_key, 60*60*24*365*10)
    print(f"  → Street-to-ID mapping created")

def get_location_info(street_name: str = None, location_id: str = None) -> dict:
    """Holt Standort-Informationen"""
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )
    
    if street_name:
        key = f"location:name:{street_name}"
    elif location_id:
        key = f"location:id:{location_id}"
    else:
        return None
    
    data = r.hgetall(key)
    
    if data:
        return {
            'location_id': data['location_id'],
            'street_name': data['street_name'],
            'city': data['city'],
            'latitude': float(data['latitude']),
            'longitude': float(data['longitude']),
            'geo_shape': json.loads(data['geo_shape']) if data['geo_shape'] else {}
        }
    return None

if __name__ == "__main__":
    csv_path = "/app/data/counterGeoLocations.csv"
    import_counter_locations_to_redis(csv_path)
    
    # Test
    print("\n" + "="*60)
    print("Testing location lookup...")
    
    for street in ["Kaiserstraße", "Spiegelstraße", "Schönbornstraße"]:
        info = get_location_info(street_name=street)
        if info:
            print(f"{street}: ID={info['location_id']}, Coords=({info['latitude']}, {info['longitude']})")
        else:
            print(f"{street}: Not found")