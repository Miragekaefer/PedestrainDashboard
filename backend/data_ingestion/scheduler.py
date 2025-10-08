# scheduler.py
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from data_ingestion.api_fetcher import APIFetcher
from database.redis_client import PedestrianRedisClient
from datetime import datetime, timedelta
import logging
import config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

redis_client = PedestrianRedisClient(host=config.REDIS_HOST, port=config.REDIS_PORT)
fetcher = APIFetcher(
    base_url="https://opendata.wuerzburg.de",
    redis_client=redis_client
)

scheduler = BlockingScheduler()

def get_latest_data_timestamp(street: str) -> datetime:
    """
    Checks Redis index to find the latest timestamp for a given street.
    Returns the latest timestamp, or a default start date if no data exists.
    """
    try:
        index_key = f"pedestrian:index:{street}"
        
        # Get the last entry from the sorted set (highest score = latest timestamp)
        latest_entries = redis_client.client.zrange(index_key, -1, -1, withscores=True)
        
        if latest_entries:
            # Score is the timestamp
            latest_timestamp = latest_entries[0][1]
            latest_dt = datetime.fromtimestamp(latest_timestamp)
            logger.info(f"Latest data for {street}: {latest_dt.isoformat()}")
            return latest_dt
        else:
            # No data found, start from a reasonable default (e.g., 2019)
            default_start = datetime(2019, 1, 1, 0, 0, 0)
            logger.info(f"No existing data for {street}, starting from {default_start.isoformat()}")
            return default_start
    except Exception as e:
        logger.error(f"Error checking latest data for {street}: {e}")
        # Default to a safe start date
        return datetime(2019, 1, 1, 0, 0, 0)


def fetch_missing_data():
    """
    Fetches all missing data from the last known timestamp until now.
    This runs on startup and ensures we have complete historical data.
    """
    streets = ["Kaiserstraße", "Spiegelstraße", "Schönbornstraße"]
    
    for street in streets:
        logger.info(f"\n{'='*60}")
        logger.info(f"Checking missing data for {street}...")
        logger.info(f"{'='*60}")
        
        try:
            # Find the latest data we have
            latest_dt = get_latest_data_timestamp(street)
            now = datetime.now()
            
            # Calculate time difference
            time_diff = now - latest_dt
            
            if time_diff.total_seconds() < 3600:  # Less than 1 hour
                logger.info(f"✓ {street} is up to date (last update: {latest_dt.isoformat()})")
                continue
            
            logger.info(f"Gap detected: {time_diff.days} days, {time_diff.seconds // 3600} hours")
            logger.info(f"Fetching data from {latest_dt.isoformat()} to {now.isoformat()}")
            
            # Fetch missing data month by month to avoid API limits
            current_date = latest_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            end_date = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            
            # Add one month to end date to include current month
            if end_date.month == 12:
                end_date = end_date.replace(year=end_date.year + 1, month=1)
            else:
                end_date = end_date.replace(month=end_date.month + 1)
            
            total_records = 0
            
            while current_date <= end_date:
                year_month = current_date.strftime('%Y-%m')
                logger.info(f"  Processing {year_month}...")
                
                month_records = 0
                for batch in fetcher._paginated_fetch_by_month(street, year_month):
                    records_stored = fetcher._store_batch(street, batch)
                    month_records += records_stored
                    total_records += records_stored
                
                logger.info(f"    → {year_month}: {month_records} records")
                
                # Move to next month
                if current_date.month == 12:
                    current_date = current_date.replace(year=current_date.year + 1, month=1)
                else:
                    current_date = current_date.replace(month=current_date.month + 1)
            
            logger.info(f"✓ Completed {street}: {total_records} records fetched")
            
        except Exception as e:
            logger.error(f"Error fetching missing data for {street}: {e}", exc_info=True)


# STARTUP: Fetch missing data immediately when service starts
def on_startup():
    """
    Runs once when the scheduler starts.
    Checks for missing data and fetches it.
    """
    logger.info("\n" + "="*60)
    logger.info("SCHEDULER STARTUP - Checking for missing data...")
    logger.info("="*60 + "\n")
    
    try:
        fetch_missing_data()
        logger.info("\n✓ Startup data sync completed!")
    except Exception as e:
        logger.error(f"Startup data sync failed: {e}", exc_info=True)


# HOURLY: Fetch only the latest data (last 3 hours for safety)
@scheduler.scheduled_job(CronTrigger(minute=5))
def fetch_hourly_updates():
    """
    Fetches the latest data every hour.
    Uses a 3-hour lookback window to ensure no data is missed.
    """
    logger.info("\n" + "-"*60)
    logger.info("HOURLY UPDATE - Fetching latest data...")
    logger.info("-"*60)
    
    try:
        fetcher.fetch_latest_updates(hours_back=3)
        logger.info("✓ Hourly update completed")
    except Exception as e:
        logger.error(f"Hourly update failed: {e}", exc_info=True)


if __name__ == "__main__":
    logger.info("""
    ╔════════════════════════════════════════════════════════════╗
    ║   PEDESTRIAN DATA SCHEDULER                                ║
    ║   Intelligent data fetching from opendata.wuerzburg.de    ║
    ╚════════════════════════════════════════════════════════════╝
    """)
    
    # Run initial data sync on startup
    on_startup()
    
    # Start the scheduler for hourly updates
    logger.info("\nStarting scheduler for hourly updates...")
    logger.info("Next update: Every hour at minute 5\n")
    
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("\nScheduler stopped by user")
    except Exception as e:
        logger.error(f"Scheduler error: {e}", exc_info=True)