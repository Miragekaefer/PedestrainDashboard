import os
from dotenv import load_dotenv

load_dotenv()

REDIS_HOST = os.getenv('REDIS_HOST', 'redis')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
OPENWEATHER_API_KEY = os.getenv('OPENWEATHER_API_KEY', '2f46f96ef57103c2851130426d6b6f61')
API_BASE_URL = "https://opendata.wuerzburg.de"