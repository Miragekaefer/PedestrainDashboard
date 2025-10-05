# scheduler.py
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from data_ingestion.api_fetcher import APIFetcher
from data_ingestion.weather_fetcher import WeatherFetcher
from database.redis_client import PedestrianRedisClient
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

redis_client = PedestrianRedisClient()
fetcher = APIFetcher(
    base_url="https://opendata.wuerzburg.de",
    redis_client=redis_client
)

scheduler = BlockingScheduler()

# INITIAL LOAD: Nur einmal manuell ausführen
def initial_historical_load():
    """Lädt alle historischen Daten - nur einmal ausführen!"""
    logger.info("Starting initial historical data load...")
    fetcher.fetch_all_historical_data()
    logger.info("Initial load completed!")

# STÜNDLICH: Nur neue Daten (letzte 2 Stunden zur Sicherheit)
@scheduler.scheduled_job(CronTrigger(minute=5))
def fetch_hourly_updates():
    """Holt nur die neuesten Daten"""
    logger.info("Fetching hourly updates...")
    try:
        fetcher.fetch_latest_updates(hours_back=2)
        logger.info("Hourly update completed")
    except Exception as e:
        logger.error(f"Hourly update failed: {e}")

# TÄGLICH 2 UHR: Model Training
@scheduler.scheduled_job(CronTrigger(hour=2, minute=0))
def train_models():
    """Trainiert Vorhersagemodelle"""
    logger.info("Starting daily model training...")
    try:
        # trainer = ModelTrainer(redis_client) # --- Hier wird Model aufgerufen/trainiert ---
        for street in ["Kaiserstraße", "Spiegelstraße", "Schönbornstraße"]:
            logger.info(f"Training model for {street}...")
            # trainer.train_and_predict(street, forecast_days=7)
        logger.info("Model training completed")
    except Exception as e:
        logger.error(f"Model training failed: {e}")

# TÄGLICH 3 UHR: Wetter-Forecast holen
@scheduler.scheduled_job(CronTrigger(hour=3, minute=0))
def fetch_weather_forecast():
    """Holt 7-Tage Wettervorhersage"""
    logger.info("Fetching weather forecast...")
    try:
        weather = WeatherFetcher(redis_client)
        weather.fetch_7day_forecast()
        logger.info("Weather forecast updated")
    except Exception as e:
        logger.error(f"Weather fetch failed: {e}")

if __name__ == "__main__":
    # Für initial load, dann auskommentieren:
    # initial_historical_load()
    
    logger.info("Starting scheduler...")
    scheduler.start()