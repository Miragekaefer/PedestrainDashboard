# backend/ML/predict.py
import sys
sys.path.append('/app')

import redis
import pandas as pd
import numpy as np

import os
import pickle
from sklearn.preprocessing import LabelEncoder
from datetime import datetime, timedelta
import requests
from database.redis_client import PedestrianRedisClient
import config
import logging

logger = logging.getLogger(__name__)

API_KEY = os.getenv("OPENWEATHER_API_KEY")
if not API_KEY:
    raise ValueError("OPENWEATHER_API_KEY environment variable is not set")

def fetch_weather_forecast(city_name: str, api_key: str):
    """
    Fetches 5-day (3-hourly) weather forecast from OpenWeatherMap,
    remaps conditions to model-compatible labels, and expands them
    to hourly intervals by forward-filling each 3-hour prediction.
    """

    url = f"https://api.openweathermap.org/data/2.5/forecast?q={city_name}&appid={api_key}&units=metric"
    response = requests.get(url)
    response.raise_for_status()
    data = response.json()

    def remap_condition(main: str, description: str, clouds: float, is_night: bool) -> str:
        main = main.lower()
        description = description.lower()

        if main == "clear":
            return "clear-night" if is_night else "clear-day"
        elif main == "clouds":
            if clouds < 50:
                return "partly-cloudy-night" if is_night else "partly-cloudy-day"
            else:
                return "cloudy"
        elif main in ("rain", "drizzle", "thunderstorm"):
            return "rain"
        elif main == "snow":
            return "snow"
        elif main in ("mist", "fog", "haze", "smoke", "dust", "sand"):
            return "fog"
        elif main in ("squall", "tornado"):
            return "wind"
        else:
            return "cloudy"

    # Step 1: get raw 3-hour forecasts
    weather_entries = []
    for entry in data["list"]:
        dt = datetime.fromtimestamp(entry["dt"])
        temp = entry["main"]["temp"]

        main = entry["weather"][0]["main"]
        description = entry["weather"][0]["description"]
        clouds = entry.get("clouds", {}).get("all", 0)
        hour = dt.hour
        is_night = hour < 6 or hour >= 18

        remapped = remap_condition(main, description, clouds, is_night)

        weather_entries.append({
            "datetime": dt,
            "temperature": temp,
            "weather_condition": remapped
        })

    df_weather = pd.DataFrame(weather_entries).sort_values("datetime").reset_index(drop=True)

    # Step 2: expand each 3-hour forecast into hourly rows
    expanded_entries = []
    for i, row in df_weather.iterrows():
        current_time = row["datetime"]
        next_time = (
            df_weather.loc[i + 1, "datetime"]
            if i + 1 < len(df_weather)
            else current_time + timedelta(hours=3)
        )

        while current_time < next_time:
            expanded_entries.append({
                "datetime": current_time,
                "temperature": row["temperature"],
                "weather_condition": row["weather_condition"],
            })
            current_time += timedelta(hours=1)

    df_expanded = pd.DataFrame(expanded_entries)
    df_expanded["date"] = df_expanded["datetime"].dt.strftime("%Y-%m-%d")
    df_expanded["hour"] = df_expanded["datetime"].dt.hour

    # df_expanded = df_expanded.set_index("datetime").asfreq("1H", method="ffill").reset_index() # GPT Empfehlung für noch mehr forecast über 5 tage hinaus, dunno

    return df_expanded

def generate_future_dataset_from_latest(latest_date: str, latest_hour: int, api_key: str, hours_ahead: int = 24*8):
    """
    Generates a future dataset starting from the hour after the latest entry,
    using OpenWeather forecasts expanded to hourly intervals.
    Any missing early hours are filled using the last known forecast
    instead of default placeholders.

    Parameters:
    - latest_date: str, format 'YYYY-MM-DD'
    - latest_hour: int, 0-23
    - hours_ahead: total number of hours to generate into the future

    Returns:
    - pd.DataFrame with columns: 
      ['id','streetname','date','hour','temperature','weather_condition','incidents','weekday','collection_type','city']
    """
    streets = ["Kaiserstraße", "Spiegelstraße", "Schoenbornstraße"]
    city = "Wuerzburg,de"
    incidents = "no_incident"
    collection_type = "measured"
    city_name = "Wuerzburg"
    api_key = API_KEY

    df_weather = fetch_weather_forecast(city, api_key)

    start_datetime = datetime.strptime(latest_date, "%Y-%m-%d") + timedelta(hours=latest_hour + 1)
    end_datetime = start_datetime + timedelta(hours=hours_ahead - 1)

    # Step 1: If the forecast starts after our desired start time,
    # use the most recent known forecast before the start
    first_forecast_time = df_weather["datetime"].min()

    if start_datetime < first_forecast_time:
        print(f" Forecast starts at {first_forecast_time}, filling earlier hours using last known forecast.")
        last_known_forecast = df_weather.iloc[0]  # first available forecast
    else:
        # last forecast *before* the start time (may not exist if the forecast starts later)
        last_known_forecast = (
            df_weather[df_weather["datetime"] <= start_datetime]
            .sort_values("datetime")
            .iloc[-1]
            if not df_weather[df_weather["datetime"] <= start_datetime].empty
            else df_weather.iloc[0]
        )

    # Step 2: Build hourly entries, filling from df_weather if available
    future_entries = []
    for h in range(hours_ahead):
        current_datetime = start_datetime + timedelta(hours=h)
        date_str = current_datetime.strftime("%Y-%m-%d")
        hour = current_datetime.hour
        weekday_name = current_datetime.strftime("%A")

        # Match forecast by datetime
        weather_row = df_weather.loc[df_weather["datetime"] == current_datetime]

        if not weather_row.empty:
            temperature = weather_row["temperature"].values[0]
            weather_condition = weather_row["weather_condition"].values[0]
        else:
            # Use last known realistic forecast instead of defaults
            temperature = last_known_forecast["temperature"]
            weather_condition = last_known_forecast["weather_condition"]

        for street in streets:
            entry = {
                "id": f"{street}_{date_str}_{hour}",
                "streetname": street,
                "date": date_str,
                "hour": hour,
                "temperature": temperature,
                "weather_condition": weather_condition,
                "incidents": incidents,
                "weekday": weekday_name,
                "collection_type": collection_type,
                "city": city_name,
            }
            future_entries.append(entry)

    return pd.DataFrame(future_entries)

def create_lag_features(df, target_cols, lag_hours=[1, 2, 3, 24, 168], rolling_windows=[3, 6, 12, 24], is_train=True):
    df = df.copy()
    df = df.sort_values(['streetname', 'datetime'])
    
    if is_train:
        avg_values = {}
        for street in df['streetname'].unique():
            street_mask = df['streetname'] == street
            street_data = df[street_mask]
            
            avg_values[street] = {}
            for target in target_cols:
                if target in df.columns:
                    avg_values[street][f'{target}_dow_avg'] = street_data.groupby('day_of_week')[target].mean().to_dict()
                    avg_values[street][f'{target}_hour_avg'] = street_data.groupby('hour')[target].mean().to_dict()
                    avg_values[street][f'{target}_hour_of_week_avg'] = street_data.groupby('hour_of_week')[target].mean().to_dict()
                    avg_values[street][f'{target}_recent'] = street_data[target].iloc[-lag_hours[0]:].mean()
        return df, avg_values
    else:
        for street in df['streetname'].unique():
            street_mask = df['streetname'] == street
            for window in rolling_windows:
                df.loc[street_mask, f'temp_rolling_mean_{window}h'] = df.loc[street_mask, 'temperature'].rolling(window=window, min_periods=1).mean()
            df.loc[street_mask, 'temp_hour_avg'] = df.loc[street_mask].groupby('hour')['temperature'].transform('mean')
            df.loc[street_mask, 'temp_dow_avg'] = df.loc[street_mask].groupby('day_of_week')['temperature'].transform('mean')
        return df, None

def create_base_time_features(df):
    df = df.copy()
    df['datetime'] = pd.to_datetime(df['date']) + pd.to_timedelta(df['hour'], unit='h')
    df['year'], df['month'], df['day'] = df['datetime'].dt.year, df['datetime'].dt.month, df['datetime'].dt.day
    df['day_of_week'] = df['datetime'].dt.dayofweek
    df['hour_of_week'] = df['day_of_week'] * 24 + df['hour']
    
    for unit, period in [('hour', 24), ('day_of_week', 7), ('month', 12)]:
        df[f'{unit}_sin'] = np.sin(2 * np.pi * df[unit]/period)
        df[f'{unit}_cos'] = np.cos(2 * np.pi * df[unit]/period)
    
    return df

def create_time_block_features(df):
    time_blocks = {
        'is_weekend': df['day_of_week'].isin([5, 6]),
        'is_peak_day': df['day_of_week'].isin([2,3,4]),
        'is_morning_rush': (df['hour'].between(7, 9)),
        'is_evening_rush': (df['hour'].between(16, 18)),
        'is_rush_hour': (df['hour'].between(7, 9) | df['hour'].between(16, 18)),
        'is_shopping_hours': (df['hour'].between(10, 19)),
        'is_working_hours': (df['hour'].between(9, 17)),
        'is_lunch_time': (df['hour'].between(11, 14)),
        'is_night': ((df['hour'] >= 22) | (df['hour'] <= 5)),
        'is_tourist_hours': (df['hour'].between(10, 18))
    }
    
    for name, condition in time_blocks.items():
        df[name] = condition.astype(int)
    return df

def create_weather_features(df):
    df['weather_encoded'] = df['weather_condition'].map({
        'partly-cloudy-day': 1, 'partly-cloudy-night': 2, 'cloudy': 3,
        'clear-day': 4, 'clear-night': 5, 'rain': 6
    })
    
    df = pd.concat([df, pd.get_dummies(df['weather_condition'], prefix='weather')], axis=1)
    df['temp_squared'], df['temp_norm'] = df['temperature'] ** 2, (df['temperature'] - 15) / 10
    
    df['temp_band'] = pd.cut(df['temperature'], bins=[-np.inf, 5, 15, 25, np.inf], labels=['cold', 'mild', 'warm', 'hot'])
    df = pd.concat([df, pd.get_dummies(df['temp_band'], prefix='temp')], axis=1)
    return df

def add_wurzburg_events(df):
    eventsDf = pd.read_csv("data/events_daily.csv")
    lecturesDf = pd.read_csv("data/lectures_daily.csv")

    # Split up date in eventsDf into date and hour
    eventsDf['hour'] = pd.to_datetime(eventsDf['date']).dt.hour.astype('int64')
    eventsDf['date'] = pd.to_datetime(eventsDf['date']).dt.date.astype('str')

    df = df.merge(eventsDf, on=['date', 'hour'], how='left')
    df = df.merge(lecturesDf, on='date', how='left')

    df['is_exam_period'] = (df['month'].isin([1, 2, 7, 8])).astype(int)

    return df

def add_enhanced_holiday_features(df):
    publicHolidaysDf = pd.read_csv("data/bavarian_public_holidays_daily.csv")
    schoolHolidaysDf = pd.read_csv("data/bavarian_school_holidays_daily.csv")

    df = df.merge(publicHolidaysDf, on='date', how='left')

    df['is_bridge_day'] = (
        ((df['public_holiday'].shift(1) == 1) & (df['is_weekend'] == 1)) |
        ((df['public_holiday'] == 1) & (df['is_weekend'].shift(-1) == 1))
    ).astype(int)

    df['is_public_holiday_nationwide'] = (df['public_holiday'] & df['nationwide'])

    df = df.merge(schoolHolidaysDf, on='date', how='left')

    # Rename 'public_holiday' to 'is_public_holiday' and 'school_holiday' to 'is_school_holiday'
    df.rename(columns={'public_holiday': 'is_public_holiday', 'school_holiday': 'is_school_holiday'}, inplace=True)
    
    return df

def add_street_features(df):
    df['street_encoded'] = LabelEncoder().fit_transform(df['streetname'])
    df['is_kaiserstrasse_shopping'] = ((df['streetname'] == 'Kaiserstrasse') & (df['is_shopping_hours'] == 1)).astype(int)
    df['is_spiegelstrasse_rush'] = ((df['streetname'] == 'Spiegelstrasse') & (df['is_rush_hour'] == 1)).astype(int)
    return df

def create_interaction_features(df):
    interactions = {
        'temp_hour': df['temperature'] * df['hour'],
        'weekend_hour': df['is_weekend'] * df['hour'],
        'temp_shopping_hours': df['temperature'] * df['is_shopping_hours'],
        'rain_rush_hour': (df['weather_condition'] == 'rain') & df['is_rush_hour'],
        'rain_weekend': (df['weather_condition'] == 'rain') & df['is_weekend']
    }
    
    for name, interaction in interactions.items():
        df[name] = interaction.astype(int)
    return df

def create_seasonal_features(df):
    df['covid_lockdown'] = ((df['date'] >= '2020-03') & (df['date'] <= '2020-06')).astype(int)
    df['covid_lockdown_lift'] = ((df['date'] >= '2020-06') & (df['date'] <= '2021-05')).astype(int)
    df['covid_lull'] = ((df['date'] >= '2021-06') & (df['date'] <= '2022-04')).astype(int)
    df['post_covid_recovery'] = ((df['date'] >= '2022-05') & (df['date'] <= '2022-12')).astype(int)

    df['season'] = pd.cut(df['month'], bins=[0,3,6,9,12], labels=['winter','spring','summer','fall'])
    df = pd.concat([df, pd.get_dummies(df['season'], prefix='season')], axis=1)
    
    df['is_tourist_season'] = df['month'].isin([5,6,7,8,9,10]).astype(int)
    df['is_weekend_tourist_season'] = (df['is_weekend'] & df['is_tourist_season']).astype(int)
    return df

def create_all_features(df, is_train=True, train_avg_values=None):
    original_index = df.index
    df = create_base_time_features(df)
    df = create_time_block_features(df)
    df = create_weather_features(df)
    df = create_seasonal_features(df)
    df = add_wurzburg_events(df)
    df = add_enhanced_holiday_features(df)
    df = create_interaction_features(df)
    df = add_street_features(df)
    
    target_cols = ['n_pedestrians', 'n_pedestrians_towards', 'n_pedestrians_away']
    
    if is_train:
        df, avg_values = create_lag_features(df, target_cols=target_cols, is_train=True)
    else:
        df, _ = create_lag_features(df, target_cols=target_cols, is_train=False)
        
        if train_avg_values:
            for street in df['streetname'].unique():
                street_mask = df['streetname'] == street
                if street in train_avg_values:
                    for target in target_cols:
                        df.loc[street_mask, f'{target}_dow_avg'] = df.loc[street_mask, 'day_of_week'].map(
                            train_avg_values[street][f'{target}_dow_avg'])
                        df.loc[street_mask, f'{target}_hour_avg'] = df.loc[street_mask, 'hour'].map(
                            train_avg_values[street][f'{target}_hour_avg'])
                        df.loc[street_mask, f'{target}_hour_of_week_avg'] = df.loc[street_mask, 'hour_of_week'].map(
                            train_avg_values[street][f'{target}_hour_of_week_avg'])
                        
                        recent_value = train_avg_values[street][f'{target}_recent']
                        for lag in [1, 2, 3, 24, 168]:
                            df.loc[street_mask, f'{target}_lag_{lag}h'] = recent_value
    
    le = LabelEncoder()
    for col in df.select_dtypes(include=['object']).columns:
        if col not in ['id', 'streetname', 'date']:
            df[f'{col}_encoded'] = le.fit_transform(df[col])
    
    df.index = original_index
    
    return (df, avg_values) if is_train else df

def get_feature_columns(df):
    exclude_cols = ['id', 'datetime', 'date', 'streetname', 'city',
                   'n_pedestrians', 'n_pedestrians_towards', 'n_pedestrians_away',
                   'incidents', 'collection_type', 'season', 'temp_band', 'weather_condition']
    
    return [col for col in df.select_dtypes(include=['int64', 'float64']).columns if col not in exclude_cols]

def predict_model(input_csv: str, model_path: str, output_csv: str = "predictions.csv"):
    """
    Predict using a trained model on new data.
    """
    # Load new data
    df = pd.read_csv(input_csv)

    # Feature engineering
    df = create_all_features(df, is_train=False)

    # Load trained model
    with open(model_path, "rb") as f:
        model, feature_cols = pickle.load(f)

    # Predict
    X = df[feature_cols]
    df["prediction"] = model.predict(X)

    # Save results
    df.to_csv(output_csv, index=False)
    print(f" Predictions saved to {output_csv}")

    return df

def run_predictions_and_store():
    # Redis connection
    r = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=0,
        decode_responses=True
    )

    logger.info("Starting prediction generation...")

    #Street name mapping
    street_mapping = {
        'Kaiserstrasse': 'Kaiserstraße',
        'Spiegelstrasse': 'Spiegelstraße',
        'Schoenbornstrasse': 'Schönbornstraße'
    }

    MODEL_PATH= "ML/models/trained_model.pkl"

    try:
        # GENERATE FUTURE DATA
        now = datetime.now()
        latest_date = now.strftime("%Y-%m-%d")
        latest_hour = now.hour

        logger.info(f"Generating forecast from {latest_date} at hour {latest_hour}")

        df_future = generate_future_dataset_from_latest(
            latest_date=latest_date,
            latest_hour=latest_hour,
            api_key=API_KEY,
            hours_ahead=24 * 8  # 8 days ahead
        )

        # FEATURE ENGINEERING
        logging.info("Creating features...")
        df_features = create_all_features(df_future, is_train=False)

        # LOAD MODEL AND PREDICT
        print(" Loading trained model...")
        with open(MODEL_PATH, "rb") as f:
            model, feature_cols = pickle.load(f)

        print(" Predicting future pedestrian counts...")
        X_future = df_features[feature_cols]
        df_features["n_pedestrians"] = model.predict(X_future)

        # STORE PREDICTIONS IN REDIS
        total_predictions = 0

        base_cols = [
            'id', 'streetname', 'date', 'hour', 'temperature', 'weather_condition',
            'incidents', 'weekday', 'collection_type', 'city'
        ]
        df_output = df_features[base_cols + ['n_pedestrians']].copy()

        for _, row in df_output.iterrows():
            street_normalized = street_mapping.get(row["streetname"], row["streetname"])
            date = row["date"]
            hour = str(int(row["hour"]))

            # PREDICTION key prefix
            key = f"pedestrian:hourly:prediction:{street_normalized}:{date}:{hour}"

            # Build data dict
            data = {
                "id": row["id"],
                "street": street_normalized,
                "city": row["city"],
                "date": date,
                "hour": hour,
                "weekday": row["weekday"],
                "n_pedestrians": str(round(row["n_pedestrians"])),
                "temperature": str(round(row["temperature"])),
                "weather_condition": row["weather_condition"],
                "incidents": row["incidents"],
                'collection_type': row['collection_type'],
                "data_type": "prediction",
                "generated_at": datetime.now().isoformat()
            }

            # Remove null values
            data = {k: v for k, v in data.items() if pd.notna(v) and str(v).strip()}

            # Store in Redis
            r.hset(key, mapping=data)
            r.expire(key, 60 * 60 * 24 * 9) # 9-days

            # Counter
            total_predictions += 1
        
        logger.info(f"Total predictions stored: {total_predictions}")

        return total_predictions

    except Exception as e:
        logger.error(f"Error during prediction generation: {e}", exc_info=True)
        raise

# Run prediction standalone for testing
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s - %(message)s')
    run_predictions_and_store()