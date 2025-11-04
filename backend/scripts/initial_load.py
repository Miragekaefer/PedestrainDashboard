# backend/scripts/initial_load.py
import sys
sys.path.append('/app')

import time
import redis
from datetime import datetime
from typing import Callable, Optional
import config

# Import all functions
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
from scripts.build_indexes import build_sorted_set_indexes
from data_ingestion.api_fetcher import APIFetcher
from database.redis_client import PedestrianRedisClient
from ML.predict import run_predictions_and_store


# ============================================================================
# CONFIGURATION
# ============================================================================

REDIS_PATTERNS = {
    'holidays': 'holiday:*',
    'holidays_detail': 'holiday:detail:*',
    'school_holidays': 'school_holiday:*',
    'school_holidays_detail': 'school_holiday:day:*',
    'events': 'event:*',
    'events_detail': 'event:detail:hour:*',
    'lectures': 'lecture:daily:*',
    'lectures_detail': 'lecture:detail:*',
    'locations': 'location:id:*',
    'pedestrian': 'pedestrian:hourly:*',
    'predictions': 'pedestrian:hourly:prediction:*'
}

IMPORT_TASKS = [
    {
        'name': 'Public Holidays (Daily)',
        'path': '/app/data/bavarian_public_holidays_daily.csv',
        'function': import_holidays_to_redis,
        'check_type': 'holidays',
        'skip_if_exists': True  # Check before running
    },
    {
        'name': 'Public Holidays (Detailed)',
        'path': '/app/data/bavarian_public_holidays.csv',
        'function': import_detailed_holidays_to_redis,
        'check_type': 'holidays_detail',
        'skip_if_exists': True
    },
    {
        'name': 'School Holidays (Daily)',
        'path': '/app/data/bavarian_school_holidays_daily.csv',
        'function': import_school_holidays_to_redis,
        'check_type': 'school_holidays',
        'skip_if_exists': True
    },
    {
        'name': 'School Holidays (Detailed)',
        'path': '/app/data/bavarian_school_holidays.csv',
        'function': import_detailed_school_holidays_to_redis,
        'check_type': 'school_holidays_detail',
        'skip_if_exists': True
    },
    {
        'name': 'Events (Daily)',
        'path': '/app/data/events_daily.csv',
        'function': import_events_to_redis,
        'check_type': 'events',
        'skip_if_exists': True
    },
    {
        'name': 'Events (Detailed)',
        'path': '/app/data/events.csv',
        'function': import_detailed_events_to_redis,
        'check_type': 'events_detail',
        'skip_if_exists': True
    },
    {
        'name': 'Lectures (Daily)',
        'path': '/app/data/lectures_daily.csv',
        'function': import_lectures_daily_to_redis,
        'check_type': 'lectures',
        'skip_if_exists': True
    },
    {
        'name': 'Lectures (Periods)',
        'path': '/app/data/lectures.csv',
        'function': import_lectures_to_redis,
        'check_type': 'lectures_detail',
        'skip_if_exists': True
    },
    {
        'name': 'Counter Locations',
        'path': '/app/data/counterGeoLocations.csv',
        'function': import_counter_locations_to_redis,
        'check_type': 'locations',
        'skip_if_exists': True
    },
    {
        'name': 'Historical Data (All Streets)',
        'path': '/app/data/dataAllStreets.csv',
        'function': import_data_all_streets_to_redis,
        'check_type': 'pedestrian',
        'skip_if_exists': True
    }
]


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def wait_for_redis(max_attempts: int = 30) -> bool:
    """Wait until Redis is ready."""
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


def check_data_exists(r: redis.Redis, check_type: str, min_keys: int = 20) -> tuple[bool, int]:
    """
    Check if data already exists in Redis.
    
    Returns:
        (exists: bool, count: int)
    """
    pattern = REDIS_PATTERNS.get(check_type)
    if not pattern:
        return False, 0
    
    count = 0
    for _ in r.scan_iter(match=pattern, count=100):
        count += 1
        if count >= min_keys:
            return True, count
    
    return count > 0, count


def run_task(
    name: str,
    function: Callable,
    path: Optional[str] = None,
    check_type: Optional[str] = None,
    redis_client: Optional[redis.Redis] = None,
    skip_if_exists: bool = True,
    skip_threshold: int = 20
) -> dict:
    """
    Execute a single import task with error handling.
    
    Args:
        name: Display name of the task
        function: Function to execute
        path: Optional file path (for CSV imports)
        check_type: Type for existence check
        redis_client: Redis connection for checking existing data
        skip_if_exists: If True, skip task if data already exists
        skip_threshold: Minimum number of keys to skip task
    
    Returns:
        Result dictionary with status and duration
    """
    # Check if data already exists (only if skip_if_exists is True)
    if skip_if_exists and check_type and redis_client:
        exists, count = check_data_exists(redis_client, check_type, min_keys=skip_threshold)
        if exists:
            print(f"⏭  SKIPPED: Data already exists (~{count}+ records found)")
            return {
                'name': name,
                'status': '⏭  SKIPPED (data exists)',
                'duration': 0
            }
    
    # Execute task
    start_time = time.time()
    
    try:
        if path:
            result = function(path)
        else:
            result = function()
        
        duration = time.time() - start_time
        
        # Handle different return types
        if isinstance(result, int):
            print(f"✓ Completed in {duration:.2f}s ({result} records)")
        else:
            print(f"✓ Completed in {duration:.2f}s")
        
        return {
            'name': name,
            'status': '✓ SUCCESS',
            'duration': duration
        }
    
    except FileNotFoundError:
        print(f"⚠ SKIPPED: File not found - {path}")
        return {
            'name': name,
            'status': '⚠ SKIPPED (file not found)',
            'duration': 0
        }
    
    except Exception as e:
        print(f"✗ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return {
            'name': name,
            'status': f'✗ FAILED: {str(e)[:50]}',
            'duration': time.time() - start_time
        }


def fetch_api_data(redis_client: redis.Redis) -> dict:
    """Fetch data from the external API (always runs, no skip)."""
    print("Fetching latest data from API...")
    
    try:
        ped_redis_client = PedestrianRedisClient(host=config.REDIS_HOST)
        fetcher = APIFetcher(config.API_BASE_URL, ped_redis_client)
        
        start_time = time.time()
        for year in ["2024", "2025"]:
            print(f"  Fetching year {year}...")
            fetcher.fetch_all_historical_data(year=year)
        
        duration = time.time() - start_time
        print(f"✓ Completed in {duration:.2f}s")
        
        return {
            'name': 'API Data Fetch',
            'status': '✓ SUCCESS',
            'duration': duration
        }
    
    except Exception as e:
        print(f"✗ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return {
            'name': 'API Data Fetch',
            'status': f'✗ FAILED: {str(e)[:50]}',
            'duration': 0
        }


def print_header():
    """Print startup header."""
    print("=" * 70)
    print(" PEDESTRIAN PREDICTION SYSTEM - INITIAL DATA LOAD")
    print("=" * 70)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)


def print_summary(results: list[dict]):
    """Print summary of all tasks."""
    print("\n" + "=" * 70)
    print(" IMPORT SUMMARY")
    print("=" * 70)
    
    for result in results:
        duration_str = f"{result['duration']:.2f}s" if result['duration'] > 0 else "-"
        print(f"{result['status']:35s} {result['name']:30s} ({duration_str})")
    
    total_duration = sum(r['duration'] for r in results)
    success_count = sum(1 for r in results if '✓' in r['status'])
    skipped_count = sum(1 for r in results if '⏭' in r['status'])
    failed_count = sum(1 for r in results if '✗' in r['status'])
    
    print("=" * 70)
    print(f"Imported: {success_count}/{len(results)}")
    print(f"Skipped (already exists): {skipped_count}/{len(results)}")
    if failed_count > 0:
        print(f"Failed: {failed_count}/{len(results)}")
    print(f"Total duration: {total_duration:.2f}s")
    print(f"Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    
    return failed_count


# ============================================================================
# MAIN EXECUTION
# ============================================================================

def main():
    """Execute all import tasks sequentially."""
    
    print_header()
    
    # Wait for Redis
    if not wait_for_redis():
        print("\n✗ Failed: Redis not available")
        sys.exit(1)
    
    # Connect to Redis
    redis_client = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        decode_responses=True
    )
    
    results = []
    total_tasks = len(IMPORT_TASKS) + 3  # +3 for API, indexes, predictions
    
    # ========================================================================
    # 1. CSV IMPORTS
    # ========================================================================
    for i, task in enumerate(IMPORT_TASKS, 1):
        print(f"\n[{i}/{total_tasks}] Processing: {task['name']}")
        print("-" * 70)
        
        result = run_task(
            name=task['name'],
            function=task['function'],
            path=task['path'],
            check_type=task['check_type'],
            redis_client=redis_client,
            skip_if_exists=task.get('skip_if_exists', True)
        )
        results.append(result)
    
    # ========================================================================
    # 2. API DATA FETCH (ALWAYS RUNS)
    # ========================================================================
    print(f"\n[{len(IMPORT_TASKS)+1}/{total_tasks}] Fetching API Data")
    print("-" * 70)
    
    result = fetch_api_data(redis_client)
    results.append(result)
    
    # ========================================================================
    # 3. BUILD INDEXES
    # ========================================================================
    print(f"\n[{len(IMPORT_TASKS)+2}/{total_tasks}] Building Indexes")
    print("-" * 70)
    
    result = run_task(
        name='Build Indexes',
        function=build_sorted_set_indexes,
        redis_client=redis_client,
        skip_if_exists=True
    )
    results.append(result)
    
    # ========================================================================
    # 4. GENERATE PREDICTIONS
    # ========================================================================
    print(f"\n[{len(IMPORT_TASKS)+3}/{total_tasks}] Generating Initial Predictions (8 days)")
    print("-" * 70)
    
    result = run_task(
        name='Initial Predictions',
        function=run_predictions_and_store,
        redis_client=redis_client,
        skip_if_exists=True
    )
    results.append(result)
    
    # ========================================================================
    # 5. SUMMARY
    # ========================================================================
    failed_count = print_summary(results)
    
    if failed_count > 0:
        print(f"\n⚠ Warning: {failed_count} imports failed")
        sys.exit(1)
    else:
        print("\n✓ All imports completed successfully")
        sys.exit(0)


if __name__ == "__main__":
    main()