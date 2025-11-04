import pandas as pd
import numpy as np
import pickle
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
import lightgbm as lgb
import xgboost as xgb
from sklearn.preprocessing import LabelEncoder
import requests
from tqdm import tqdm

BASE_URL = "http://localhost:8000"

def load_pedestrian_data_from_api(base_url=f"{BASE_URL}/pedestrian"):
    """
    Fetch all available pedestrian data from the API and return as a DataFrame.
    """
    all_records = []

    try:
        # Ideally, you have an endpoint like /pedestrian/all or /pedestrian/hourly/all
        response = requests.get(f"{base_url}/hourly/all")
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        print(f"Failed to fetch pedestrian data: {e}")
        return pd.DataFrame()

    # alles was wir aus der API erstmal kriegen
    for item in tqdm(data, desc="Processing pedestrian entries"):
        try:
            basic = item.get("basic_info", {})
            counts = item.get("counts", {})
            weather = item.get("weather", {})
            meta = item.get("metadata", {})

            all_records.append({
                "id": basic.get("id"),
                "streetname": basic.get("street"),
                "city": basic.get("city"),
                "date": basic.get("date"),
                "hour": basic.get("hour"),
                "weekday": basic.get("weekday"),
                "n_pedestrians": counts.get("total"),
                "n_pedestrians_towards": counts.get("towards_center"),
                "n_pedestrians_away": counts.get("away_from_center"),
                "temperature": weather.get("temperature"),
                "weather_condition": weather.get("condition"),
                "incidents": meta.get("incidents", "no_incident"),
                "collection_type": meta.get("collection_type", "measured")
            })
        except Exception as e:
            print(f" Skipped entry due to error: {e}")

    df = pd.DataFrame(all_records)
    return df


"""def preprocess_training_data(raw_csv_path: str) -> pd.DataFrame:

    df = pd.read_csv(raw_csv_path, sep=';')

    # Split location into streetname and city
    df[['streetname', 'city']] = df['location'].str.split(',', expand=True)
    df['city'] = df['city'].str.strip()
    df['streetname'] = df['streetname'].str.strip()

    # Convert time of measurement to datetime
    df['datetime'] = pd.to_datetime(df['time of measurement'], errors='coerce', utc=True)
    df['date'] = df['datetime'].dt.date.astype(str)
    df['hour'] = df['datetime'].dt.hour

    # Rename columns
    df.rename(columns={
        'pedestrians count': 'n_pedestrians',
        'towards Hauptbahnhof pedestrians count': 'n_pedestrians_towards',
        'towards Juliuspromenade pedestrians count': 'n_pedestrians_away',
        'temperature in ºc': 'temperature',
        'weather condition': 'weather_condition'
    }, inplace=True)

    # Fill missing incidents
    df['incidents'] = df['incidents'].fillna('no_incident')

    # Create unique id
    df['id'] = df['streetname'] + '_' + df['date'] + '_' + df['hour'].astype(str)

    # Keep only needed columns
    df = df[['id', 'streetname', 'city', 'date', 'hour', 'weekday',
             'n_pedestrians', 'n_pedestrians_towards', 'n_pedestrians_away',
             'temperature', 'weather_condition', 'incidents', 'collection_type']]

    return df"""
# -----------------------
# Feature engineering functions
# -----------------------
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

def load_events_from_api(base_url=f"{BASE_URL}/api/events"):
    all_entries = []
    # auch hier einfach einen /all request nötig - aber vielleicht mit irgendeiner consistens das nicht jedes mal alles geladen werden muss
    dates = pd.date_range("2019-01-01", "2023-12-31").strftime("%Y-%m-%d")

    for date in tqdm(dates, desc="Fetching event data"):
        try:
            res = requests.get(f"{base_url}/{date}")
            if res.status_code != 200:
                continue
            data = res.json()

            has_event = int(data.get("has_events", False))
            has_concert = any(e.get("is_concert", False) for e in data.get("events", []))

            # Create hourly entries for the day
            for hour in range(24):
                all_entries.append({
                    "date": date,
                    "hour": hour,
                    "event": has_event,
                    "concert": int(has_concert)
                })
        except Exception as e:
            print(f" Failed to fetch {date}: {e}")

    return pd.DataFrame(all_entries)

def load_lectures_from_api(base_url=f"{BASE_URL}/api/lecture/daily"):
    # auch hier einfach einen /all request nötig - aber vielleicht mit irgendeiner consistens das nicht jedes mal alles geladen werden muss
    entries = []
    dates = pd.date_range("2019-01-01", "2023-12-31").strftime("%Y-%m-%d")

    for date in tqdm(dates, desc="Fetching lectures"):
        try:
            res = requests.get(f"{base_url}/{date}")
            if res.status_code != 200:
                continue
            data = res.json()
            entries.append({
                "date": data["date"],
                "lecture_period_jmu": int(data.get("is_lecture_period", False))
            })
        except Exception as e:
            print(f" {date}: {e}")
    return pd.DataFrame(entries)

def add_wurzburg_events(df):
    eventsDf = load_events_from_api()
    lecturesDf = load_lectures_from_api()

    df = df.merge(eventsDf, on=["date", "hour"], how="left")
    df = df.merge(lecturesDf, on="date", how="left")

    df["is_exam_period"] = df["month"].isin([1, 2, 7, 8]).astype(int)
    return df

def load_public_holidays_from_api(base_url=f"{BASE_URL}/api/holiday"):
    entries = []
    dates = pd.date_range("2019-01-01", "2023-12-31").strftime("%Y-%m-%d")

    for date in tqdm(dates, desc="Fetching public holidays"):
        try:
            res = requests.get(f"{base_url}/{date}")
            if res.status_code != 200:
                continue
            data = res.json()
            entries.append({
                "date": data["date"],
                "public_holiday": int(data.get("is_holiday", False)),
                "nationwide": int(data.get("is_nationwide", False))
            })
        except Exception as e:
            print(f" {date}: {e}")
    return pd.DataFrame(entries)

def load_school_holidays_from_api(base_url=f"{BASE_URL}/api/school-holiday"):
    try:
        res = requests.get(base_url)
        res.raise_for_status()
        data = res.json()
    except Exception as e:
        print(f" Failed to fetch school holidays: {e}")
        return pd.DataFrame()

    entries = []
    for item in data:
        entries.append({
            "date": item["date"],
            "school_holiday": int(item.get("is_school_holiday", False))
        })
    return pd.DataFrame(entries)

def add_enhanced_holiday_features(df):
    publicHolidaysDf = load_public_holidays_from_api()
    schoolHolidaysDf = load_school_holidays_from_api()

    df = df.merge(publicHolidaysDf, on="date", how="left")

    df["is_bridge_day"] = (
        ((df["public_holiday"].shift(1) == 1) & (df["is_weekend"] == 1)) |
        ((df["public_holiday"] == 1) & (df["is_weekend"].shift(-1) == 1))
    ).astype(int)

    df["is_public_holiday_nationwide"] = (df["public_holiday"] & df["nationwide"])

    df = df.merge(schoolHolidaysDf, on="date", how="left")
    df.rename(columns={"public_holiday": "is_public_holiday",
                       "school_holiday": "is_school_holiday"}, inplace=True)
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

def train_model(model_out: str, target_col: str = "n_pedestrians", model_type: str = "xgb"):
    """
    Train a model on your own dataset and save it to disk.
    """
    # Load raw CSV
    df = load_pedestrian_data_from_api()
    print(f"✅ Loaded {len(df)} pedestrian records")
    # Feature engineering
    df, avg_values = create_all_features(df, is_train=True)

    # Select numeric features
    feature_cols = get_feature_columns(df)

    # Drop rows with missing target
    df = df.dropna(subset=[target_col])

    X = df[feature_cols]
    y = df[target_col]

    # Train/validation split
    X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, shuffle=False)

    # Initialize model
    if model_type == "xgb":
        model = xgb.XGBRegressor(
            n_estimators=500,
            learning_rate=0.02,
            max_depth=7,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            n_jobs=4
        )
    elif model_type == "lgb":
        model = lgb.LGBMRegressor(
            n_estimators=500,
            learning_rate=0.01,
            max_depth=8,
            num_leaves=200,
            subsample=0.8,
            colsample_bytree=0.8,
            reg_lambda=0.1,
            random_state=42,
            n_jobs=4
        )
    else:
        raise ValueError("Unknown model_type: choose 'xgb' or 'lgb'")

    # Train model
    model.fit(X_train, y_train)

    # Validation evaluation
    preds = model.predict(X_val)
    print("Validation Results:")
    print(f" MSE: {mean_squared_error(y_val, preds):.2f}")
    print(f" RMSE: {np.sqrt(mean_squared_error(y_val, preds)):.2f}")
    print(f" MAE: {mean_absolute_error(y_val, preds):.2f}")
    print(f" R2: {r2_score(y_val, preds):.4f}")

    # Save model + feature columns
    with open(model_out, "wb") as f:
        pickle.dump((model, feature_cols), f)

    print(f"✅ Model saved to {model_out}")

# -----------------------
# Run training
# -----------------------
if __name__ == "__main__":
    train_model(
        model_out="backend/trained_model.pkl",
        target_col="n_pedestrians",
        model_type="xgb"
    )