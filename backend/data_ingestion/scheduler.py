# backend/data_ingestion/scheduler.py
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from data_ingestion.api_fetcher import APIFetcher
from database.redis_client import PedestrianRedisClient
from datetime import datetime
import logging
import config
import time
import os, sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))



# -------------------------------------------------
# Logging setup
# -------------------------------------------------
logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# -------------------------------------------------
# Initialize Redis + Fetcher
# -------------------------------------------------
redis_client = PedestrianRedisClient(host=config.REDIS_HOST, port=config.REDIS_PORT)
fetcher = APIFetcher(
    base_url="https://opendata.wuerzburg.de",
    redis_client=redis_client
)

# Use BackgroundScheduler (container-friendly)
scheduler = BackgroundScheduler(timezone="Europe/Berlin")

# -------------------------------------------------
# Helper functions
# -------------------------------------------------
def get_latest_data_timestamp(street: str) -> datetime:
    """Find the latest timestamp for a given street in Redis."""
    try:
        index_key = f"pedestrian:index:{street}"
        latest_entries = redis_client.client.zrange(index_key, -1, -1, withscores=True)
        if latest_entries:
            latest_ts = latest_entries[0][1]
            latest_dt = datetime.fromtimestamp(latest_ts)
            logger.info(f"Latest data for {street}: {latest_dt.isoformat()}")
            return latest_dt
        else:
            default_start = datetime(2019, 1, 1)
            logger.info(f"No data for {street}, starting from {default_start.isoformat()}")
            return default_start
    except Exception as e:
        logger.error(f"Error checking latest data for {street}: {e}")
        return datetime(2019, 1, 1)

def fetch_missing_data():
    """Fetches all missing data from the API since the last known timestamp."""
    streets = ["Kaiserstraße", "Spiegelstraße", "Schönbornstraße"]

    for street in streets:
        logger.info(f"\n{'='*60}\nChecking missing data for {street}...\n{'='*60}")
        try:
            latest_dt = get_latest_data_timestamp(street)
            now = datetime.now()

            if (now - latest_dt).total_seconds() < 3600:
                logger.info(f"✓ {street} is up to date (last update: {latest_dt.isoformat()})")
                continue

            # Fetch month by month to avoid API overload
            current_date = latest_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            end_date = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            if end_date.month == 12:
                end_date = end_date.replace(year=end_date.year + 1, month=1)
            else:
                end_date = end_date.replace(month=end_date.month + 1)

            total_records = 0
            while current_date <= end_date:
                ym = current_date.strftime('%Y-%m')
                logger.info(f"Fetching {ym} for {street}...")
                for batch in fetcher._paginated_fetch_by_month(street, ym):
                    records = fetcher._store_batch(street, batch)
                    total_records += records
                if current_date.month == 12:
                    current_date = current_date.replace(year=current_date.year + 1, month=1)
                else:
                    current_date = current_date.replace(month=current_date.month + 1)

            logger.info(f"✓ Completed {street}: {total_records} records fetched")

        except Exception as e:
            logger.error(f"Error fetching missing data for {street}: {e}", exc_info=True)

# -------------------------------------------------
# Scheduled Jobs
# -------------------------------------------------
@scheduler.scheduled_job(
    CronTrigger(minute=5),  # Every hour at :05
    misfire_grace_time=300
)
def fetch_hourly_updates():
    """Fetches the latest pedestrian data every hour."""
    logger.info("\n------ HOURLY UPDATE ------")
    try:
        fetcher.fetch_latest_updates(hours_back=3)
        logger.info("✓ Hourly update completed")
    except Exception as e:
        logger.error(f"Hourly update failed: {e}", exc_info=True)

@scheduler.scheduled_job(
    CronTrigger(minute=1),  # Every hour at :01
    misfire_grace_time=300
)
def fetch_predictions():
    """Runs ML predictions every hour and uploads results to Redis."""
    logger.info("\n------ HOURLY PREDICTION ------")
    try:
        from ML.predict import run_predictions_and_store
        count = run_predictions_and_store()
        logger.info(f"✓ {count} predictions updated in Redis")
    except Exception as e:
        logger.error(f"Prediction update failed: {e}", exc_info=True)

@scheduler.scheduled_job(
    CronTrigger(hour=3, minute=30),  # every day at 03:30
    misfire_grace_time=600
)
def retrain_daily_model():
    """Retrains the ML model once per day."""
    logger.info("\n------ DAILY MODEL RETRAINING ------")
    try:
        from ML.train import run_daily_training
        model_path = run_daily_training()
        logger.info(f"✓ Daily model retraining completed → {model_path}")
    except Exception as e:
        logger.error(f"Daily model retraining failed: {e}", exc_info=True)

# -------------------------------------------------
# Startup Routine
# -------------------------------------------------
def on_startup():
    """Runs once when the scheduler starts up."""
    logger.info("\n" + "="*60)
    logger.info("SCHEDULER STARTUP: Fetching missing data and generating initial predictions...")
    logger.info("="*60 + "\n")

    try:
        fetch_missing_data()
        logger.info("✓ Startup data sync completed.")
    except Exception as e:
        logger.error(f"Startup data sync failed: {e}", exc_info=True)

    # Run first prediction immediately
    try:
        from ML.predict import run_predictions_and_store
        logger.info("Running initial ML prediction...")
        run_predictions_and_store()
        logger.info("✓ Initial predictions uploaded to Redis")
    except Exception as e:
        logger.error(f"Initial prediction failed: {e}", exc_info=True)

# -------------------------------------------------
# Main Entry
# -------------------------------------------------
if __name__ == "__main__":
    logger.info("""
    ╔════════════════════════════════════════════════════════════╗
    ║   PEDESTRIAN DATA SCHEDULER                                ║
    ║   Intelligent data + ML prediction orchestration           ║
    ╚════════════════════════════════════════════════════════════╝
    """)

    # Run startup routine
    on_startup()

    # Start scheduler loop
    scheduler.start()
    logger.info("Scheduler running... (hourly updates + 3-hour predictions)")

    # Keep alive in container
    try:
        while True:
            time.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
        logger.info("Scheduler stopped.")
