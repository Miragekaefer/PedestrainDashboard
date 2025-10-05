import os
from dotenv import load_dotenv

load_dotenv()

REDIS_HOST = os.getenv('REDIS_HOST', 'redis')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
OPENWEATHER_API_KEY = os.getenv('OPENWEATHER_API_KEY', '')
API_BASE_URL = "https://opendata.wuerzburg.de"