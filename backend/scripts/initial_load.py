# backend/scripts/initial_load.py
import sys
sys.path.append('/app')

import time
import redis
from datetime import datetime

# Import aller Subfunktionen
from scripts.import_holidays import import_holidays_to_redis
from scripts.import_holidays_detailed import import_detailed_holidays_to_redis
from scripts.import_school_holidays import import_school_holidays_to_redis
from scripts.import_school_holidays_detailed import import_detailed_school_holidays_to_redis
from scripts.import_events import import_events_to_redis
from scripts.import_events_detailed import import_detailed_events_to_redis
from scripts.import_lectures_daily import import_lectures_daily_to_redis
from scripts.import_lectures import import_lectures_to_redis
from scripts.import_counter_locations import import_counter_locations_to_redis
from scripts.import_data_all_streets import import_data_all_streets_to_redis
from data_ingestion.api_fetcher import APIFetcher
from database.redis_client import PedestrianRedisClient
import config

def wait_for_redis(max_attempts=30):
    """Wartet bis Redis bereit ist"""
    print("Waiting for Redis to be ready...")
    
    for i in range(max_attempts):
        try:
            r = redis.Redis(host=config.REDIS_HOST, port=config.REDIS_PORT)
            r.ping()
            print("✓ Redis is ready!")
            return True
        except redis.ConnectionError:
            print(f"  Attempt {i+1}/{max_attempts}: Redis not ready yet...")
            time.sleep(2)
    
    print("✗ Redis did not become ready in time")
    return False

def check_data_exists(r: redis.Redis, check_type: str) -> tuple:
    """
    Prüft ob Daten bereits vorhanden sind
    Returns: (exists: bool, count: int)
    """
    patterns = {
        'holidays': 'holiday:*',
        'holidays_detail': 'holiday:detail:*',
        'school_holidays': 'school_holiday:*',
        'school_holidays_detail': 'school_holiday:day:*',
        'events': 'event:*',
        'events_detail': 'event:detail:hour:*',
        'lectures': 'lecture:daily:*',
        'lectures_detail': 'lecture:detail:*',
        'locations': 'location:id:*',
        'pedestrian': 'pedestrian:hourly:*'
    }
    
    pattern = patterns.get(check_type)
    if not pattern:
        return False, 0
    
    # Samplen statt alle Keys zu zählen (Performance)
    count = 0
    for _ in r.scan_iter(match=pattern, count=100):
        count += 1
        if count >= 10:  # Wenn mindestens 10 Keys existieren, sind Daten vorhanden
            return True, count
    
    return count > 0, count

def main():
    """Führt alle Import-Scripts nacheinander aus"""
    
    print("="*70)
    print(" PEDESTRIAN PREDICTION SYSTEM - INITIAL DATA LOAD")
    print("="*70)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*70)
    
    # Warte auf Redis
    if not wait_for_redis():
        print("\n✗ Failed: Redis not available")
        sys.exit(1)
    
    # Redis Connection für Checks
    r = redis.Redis(host=config.REDIS_HOST, port=config.REDIS_PORT, decode_responses=True)
    
    scripts = [
        {
            'name': 'Public Holidays (Daily)',
            'path': '/app/data/bavarian_public_holidays_daily.csv',
            'function': import_holidays_to_redis,
            'check_type': 'holidays'
        },
        {
            'name': 'Public Holidays (Detailed)',
            'path': '/app/data/bavarian_public_holidays.csv',
            'function': import_detailed_holidays_to_redis,
            'check_type': 'holidays_detail'
        },
        {
            'name': 'School Holidays (Daily)',
            'path': '/app/data/bavarian_school_holidays_daily.csv',
            'function': import_school_holidays_to_redis,
            'check_type': 'school_holidays'
        },
        {
            'name': 'School Holidays (Detailed)',
            'path': '/app/data/bavarian_school_holidays.csv',
            'function': import_detailed_school_holidays_to_redis,
            'check_type': 'school_holidays_detail'
        },
        {
            'name': 'Events (Daily)',
            'path': '/app/data/events_daily.csv',
            'function': import_events_to_redis,
            'check_type': 'events'
        },
        {
            'name': 'Events (Detailed)',
            'path': '/app/data/events.csv',
            'function': import_detailed_events_to_redis,
            'check_type': 'events_detail'
        },
        {
            'name': 'Lectures (Daily)',
            'path': '/app/data/lectures_daily.csv',
            'function': import_lectures_daily_to_redis,
            'check_type': 'lectures'
        },
        {
            'name': 'Lectures (Periods)',
            'path': '/app/data/lectures.csv',
            'function': import_lectures_to_redis,
            'check_type': 'lectures_detail'
        },
        {
            'name': 'Counter Locations',
            'path': '/app/data/counterGeoLocations.csv',
            'function': import_counter_locations_to_redis,
            'check_type': 'locations'
        },
        {
            'name': 'Historical Data (All Streets)',
            'path': '/app/data/dataAllStreets.csv',
            'function': import_data_all_streets_to_redis,
            'check_type': 'pedestrian'
        }
    ]
    
    results = []
    
    for i, script in enumerate(scripts, 1):
        print(f"\n[{i}/{len(scripts)}] Processing: {script['name']}")
        print("-" * 70)
        
        # Prüfe ob Daten bereits vorhanden
        exists, count = check_data_exists(r, script['check_type'])
        
        if exists:
            print(f"⏭  SKIPPED: Data already exists (~{count}+ records found)")
            results.append({
                'name': script['name'],
                'status': '⏭  SKIPPED (data exists)',
                'duration': 0
            })
            continue
        
        start_time = time.time()
        
        try:
            script['function'](script['path'])
            duration = time.time() - start_time
            results.append({
                'name': script['name'],
                'status': '✓ SUCCESS',
                'duration': duration
            })
            print(f"✓ Completed in {duration:.2f}s")
        except FileNotFoundError:
            print(f"⚠ SKIPPED: File not found - {script['path']}")
            results.append({
                'name': script['name'],
                'status': '⚠ SKIPPED (file not found)',
                'duration': 0
            })
        except Exception as e:
            print(f"✗ FAILED: {e}")
            results.append({
                'name': script['name'],
                'status': f'✗ FAILED: {str(e)[:50]}',
                'duration': time.time() - start_time
            })
    
    # API Daten fetchen (optional)
    print(f"\n[{len(scripts)+1}/{len(scripts)+1}] Fetching API Data")
    print("-" * 70)
    
    # Prüfe ob API Daten bereits vorhanden
    api_exists, api_count = check_data_exists(r, 'pedestrian')
    
    if api_count > 1000:  # Wenn bereits viele Daten vorhanden
        print(f"⏭  SKIPPED: Pedestrian data already exists (~{api_count}+ records)")
        results.append({
            'name': 'API Data Fetch',
            'status': '⏭  SKIPPED (data exists)',
            'duration': 0
        })
    else:
        try:
            redis_client = PedestrianRedisClient(host=config.REDIS_HOST)
            fetcher = APIFetcher(config.API_BASE_URL, redis_client)
            
            start_time = time.time()
            for year in ["2024", "2025"]:
                print(f"\nFetching year {year}...")
                fetcher.fetch_all_historical_data(year=year)
            
            duration = time.time() - start_time
            results.append({
                'name': 'API Data Fetch',
                'status': '✓ SUCCESS',
                'duration': duration
            })
        except Exception as e:
            print(f"⚠ API fetch failed (this is optional): {e}")
            results.append({
                'name': 'API Data Fetch',
                'status': '⚠ SKIPPED (API unavailable)',
                'duration': 0
            })
    
    # Summary
    print("\n" + "="*70)
    print(" IMPORT SUMMARY")
    print("="*70)
    
    total_duration = sum(r['duration'] for r in results)
    success_count = sum(1 for r in results if '✓' in r['status'])
    skipped_count = sum(1 for r in results if '⏭' in r['status'])
    
    for result in results:
        duration_str = f"{result['duration']:.2f}s" if result['duration'] > 0 else "-"
        print(f"{result['status']:35s} {result['name']:30s} ({duration_str})")
    
    print("="*70)
    print(f"Imported: {success_count}/{len(results)}")
    print(f"Skipped (already exists): {skipped_count}/{len(results)}")
    print(f"Total duration: {total_duration:.2f}s")
    print(f"Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*70)
    
    # Exit Code
    failed_count = sum(1 for r in results if '✗' in r['status'])
    if failed_count > 0:
        print(f"\n⚠ Warning: {failed_count} imports failed")
        sys.exit(1)
    else:
        print("\n✓ All imports completed successfully")
        sys.exit(0)

if __name__ == "__main__":
    main()