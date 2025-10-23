# backend/api/main.py
from fastapi import FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from datetime import datetime, timedelta
from database.redis_client import PedestrianRedisClient
from pydantic import BaseModel, Field
import config
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Pedestrian Prediction API",
    description="""
    ## Würzburg Passantenzählungs- und Vorhersage-API
    
    Diese API bietet Zugriff auf:
    - **Historische Passantendaten** von drei Zählstationen in Würzburg
    - **Kalender-Features**: Feiertage, Schulferien, Events, Vorlesungszeiten
    - **Vorhersagen**: ML-basierte Prognosen für Passantenströme
    - **Geodaten**: Standorte der Zählstationen
    
    ### Verfügbare Straßen
    - Kaiserstraße
    - Spiegelstraße
    - Schönbornstraße
    
    ### Datenquellen
    - Stadt Würzburg Open Data Portal
    - Bayerisches Staatsministerium für Unterricht und Kultus
    - OpenWeather API
    """,
    version="1.0.0",
    contact={
        "name": "API Support",
        "email": "support@example.com",
    },
    license_info={
        "name": "MIT",
    }
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

redis_client = PedestrianRedisClient(host=config.REDIS_HOST, port=config.REDIS_PORT)

# ============================================
# PYDANTIC MODELS
# ============================================

class PedestrianData(BaseModel):
    id: str = Field(..., description="Eindeutige ID im Format: Straße_YYYY-MM-DD_HH")
    street: str = Field(..., description="Straßenname")
    city: str = Field(..., description="Stadt (Wuerzburg)")
    date: str = Field(..., description="Datum im Format YYYY-MM-DD")
    hour: str = Field(..., description="Stunde (0-23)")
    weekday: str = Field(..., description="Wochentag (z.B. Monday, Tuesday)")
    n_pedestrians: int = Field(..., description="Gesamtanzahl Passanten")
    n_pedestrians_towards: int = Field(..., description="Passanten Richtung Innenstadt")
    n_pedestrians_away: int = Field(..., description="Passanten von Innenstadt weg")
    temperature: Optional[float] = Field(None, description="Temperatur in °C")
    weather_condition: Optional[str] = Field(None, description="Wetterbedingung")
    incidents: str = Field(..., description="Vorfälle (verified/unverified)")
    collection_type: str = Field(..., description="Erfassungstyp (measured/estimated)")
    timestamp: Optional[str] = Field(None, description="ISO 8601 Zeitstempel")

    class Config:
        json_schema_extra = {
            "example": {
                "id": "Kaiserstraße_2019-04-02_18",
                "street": "Kaiserstraße",
                "city": "Wuerzburg",
                "date": "2019-04-02",
                "hour": "18",
                "weekday": "Tuesday",
                "n_pedestrians": 1324,
                "n_pedestrians_towards": 682,
                "n_pedestrians_away": 642,
                "temperature": 18.5,
                "weather_condition": "partly-cloudy-day",
                "incidents": "no_incident",
                "collection_type": "measured",
                "timestamp": "2019-04-02T18:00:00+02:00"
            }
        }

# ============================================
# ENDPOINTS
# ============================================

@app.get(
    "/",
    summary="API Health Check",
    description="Prüft ob die API online ist und gibt verfügbare Endpoints zurück",
    tags=["System"]
)
async def root():
    return {
        "status": "online",
        "version": "1.0.0",
        "endpoints": {
            "historical": "/api/pedestrians/historical",
            "predictions": "/api/pedestrians/predictions",
            "streets": "/api/streets",
            "statistics": "/api/statistics/{street}",
            "calendar": "/api/calendar/{date}",
            "events": "/api/events/{date}",
            "all_events": "/api/events/all_dates",
            "locations": "/api/locations"
        }
    }

@app.get(
    "/api/pedestrians/all",
    summary="Alle historischen Passantendaten abrufen",
    description="Ruft alle verfügbaren historischen Passantenzählungen für eine Straße ab (für Modelltraining).",
    tags=["Pedestrian Data"]
)
async def get_all_historical_data(street: str):
    if street not in ["Kaiserstraße", "Spiegelstraße", "Schönbornstraße"]:
        raise HTTPException(status_code=400, detail="Ungültiger Straßenname")
    
    try:
        # fetch everything at once using a very wide date range
        data = redis_client.get_historical_range(street, "1900-01-01", "2100-12-31")
        return {"street": street, "count": len(data), "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get(
    "/api/streets",
    summary="Alle Straßen abrufen",
    description="""
    Gibt eine Liste aller verfügbaren Zählstationen mit Geodaten zurück.
    
    **Rückgabe:**
    - Liste der Straßennamen
    - Anzahl der Stationen
    - Detaillierte Informationen inkl. GPS-Koordinaten
    """,
    tags=["Locations"],
    response_model=dict
)
async def get_streets():
    locations = redis_client.get_all_locations()
    
    return {
        "streets": [loc['street_name'] for loc in locations],
        "count": len(locations),
        "details": [
            {
                "name": loc['street_name'],
                "id": loc['location_id'],
                "coordinates": {
                    "lat": loc['latitude'],
                    "lon": loc['longitude']
                }
            }
            for loc in locations
        ]
    }

@app.get(
    "/api/pedestrians/historical",
    summary="Historische Passantendaten",
    description="""
    Ruft historische Passantenzählungen für einen Zeitraum ab.
    
    **Parameter:**
    - `street`: Name der Straße (Kaiserstraße, Spiegelstraße oder Schönbornstraße)
    - `start_date`: Startdatum im Format YYYY-MM-DD
    - `end_date`: Enddatum im Format YYYY-MM-DD
    - `limit`: (Optional) Maximale Anzahl Ergebnisse
    
    **Beispiel:**
    GET /api/pedestrians/historical?street=Kaiserstraße&start_date=2019-04-02&end_date=2019-04-05
    """,
    tags=["Pedestrian Data"]
)
async def get_historical_data(
    street: str = Query(..., description="Straßenname", example="Kaiserstraße"),
    start_date: str = Query(..., description="Startdatum (YYYY-MM-DD)", example="2019-04-02"),
    end_date: str = Query(..., description="Enddatum (YYYY-MM-DD)", example="2019-04-05"),
    limit: Optional[int] = Query(None, description="Max. Anzahl Ergebnisse", ge=1, le=10000)
):
    try:
        if street not in ["Kaiserstraße", "Spiegelstraße", "Schönbornstraße"]:
            raise HTTPException(status_code=400, detail="Ungültiger Straßenname. Verfügbar: Kaiserstraße, Spiegelstraße, Schönbornstraße")
        
        datetime.strptime(start_date, '%Y-%m-%d')
        datetime.strptime(end_date, '%Y-%m-%d')
        
        data = redis_client.get_historical_range(street, start_date, end_date)
        
        if limit:
            data = data[:limit]
        
        formatted_data = []
        for record in data:
            formatted_data.append({
                "id": record.get('id', ''),
                "street": record.get('street', ''),
                "city": record.get('city', ''),
                "date": record.get('date', ''),
                "hour": record.get('hour', ''),
                "weekday": record.get('weekday', ''),
                "n_pedestrians": int(record.get('n_pedestrians', 0)),
                "n_pedestrians_towards": int(record.get('n_pedestrians_towards', 0)),
                "n_pedestrians_away": int(record.get('n_pedestrians_away', 0)),
                "temperature": float(record.get('temperature', 0)) if record.get('temperature') else None,
                "weather_condition": record.get('weather_condition'),
                "incidents": record.get('incidents', 'no_incident'),
                "collection_type": record.get('collection_type', 'measured'),
                "timestamp": record.get('timestamp')
            })
        
        return {
            "street": street,
            "period": {
                "start": start_date,
                "end": end_date
            },
            "count": len(formatted_data),
            "data": formatted_data
        }
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Ungültiges Datumsformat. Nutze YYYY-MM-DD")
    except Exception as e:
        logger.error(f"Error fetching historical data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get(
    "/api/pedestrians/detailed/{street}/{date}/{hour}",
    summary="Detaillierte Passantendaten",
    description="""
    Ruft detaillierte Passantendaten für eine spezifische Stunde ab.
    
    Beinhaltet:
    - Aufschlüsselung nach Altersgruppen (Erwachsene/Kinder)
    - Richtungsinformationen
    - Zonendaten (falls vorhanden)
    - Wetterdaten
    
    **Beispiel:**
    GET /api/pedestrians/detailed/Kaiserstraße/2019-04-02/18
    """,
    tags=["Pedestrian Data"]
)
async def get_detailed_pedestrian_data(
    street: str = Path(..., description="Straßenname", example="Kaiserstraße"),
    date: str = Path(..., description="Datum (YYYY-MM-DD)", example="2019-04-02"),
    hour: int = Path(..., description="Stunde (0-23)", ge=0, le=23, example=18)
):
    try:
        datetime.strptime(date, '%Y-%m-%d')
        
        if street not in ["Kaiserstraße", "Spiegelstraße", "Schönbornstraße"]:
            raise HTTPException(status_code=400, detail="Ungültiger Straßenname")
        
        data = redis_client.get_hourly_data(street, date, hour)
        
        if not data:
            raise HTTPException(status_code=404, detail="Keine Daten gefunden für diese Zeit")
        
        return {
            "basic_info": {
                "id": data.get('id'),
                "street": data.get('street'),
                "city": data.get('city'),
                "date": data.get('date'),
                "hour": int(data.get('hour', 0)),
                "weekday": data.get('weekday'),
                "timezone": data.get('timezone')
            },
            "counts": {
                "total": int(data.get('n_pedestrians', 0)),
                "towards_center": int(data.get('n_pedestrians_towards', 0)),
                "away_from_center": int(data.get('n_pedestrians_away', 0)),
                "adults": int(data.get('n_adult', 0)),
                "children": int(data.get('n_child', 0))
            },
            "weather": {
                "temperature": float(data.get('temperature', 0)) if data.get('temperature') else None,
                "condition": data.get('weather_condition')
            },
            "metadata": {
                "incidents": data.get('incidents'),
                "collection_type": data.get('collection_type')
            }
        }
    
    except ValueError:
        raise HTTPException(status_code=400, detail="Ungültiges Datumsformat")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get(
    "/api/calendar/{date}",
    summary="Kalender-Informationen",
    description="""
    Gibt alle Kalender-relevanten Informationen für ein Datum zurück.
    
    **Beinhaltet:**
    - Feiertage (bundes- und landesweit)
    - Schulferien
    - Events und Konzerte
    - Vorlesungszeiten (JMU & THWS)
    
    **Beispiel:**
    GET /api/calendar/2019-04-02
    """,
    tags=["Calendar Features"]
)
async def get_calendar_info(
    date: str = Path(..., description="Datum (YYYY-MM-DD)", example="2019-04-02")
):
    try:
        datetime.strptime(date, '%Y-%m-%d')
        
        public_holiday = redis_client.get_detailed_holiday_info(date)
        school_holiday_period = redis_client.get_school_holiday_period(date)
        event_info = redis_client.get_event_info(date)
        lecture_info = redis_client.get_lecture_info(date)
        
        return {
            "date": date,
            "is_public_holiday": public_holiday is not None,
            "public_holiday_name": public_holiday['name'] if public_holiday else None,
            "is_nationwide_holiday": public_holiday['is_nationwide'] if public_holiday else False,
            "is_school_holiday": school_holiday_period is not None,
            "school_holiday_name": school_holiday_period['holiday_name'] if school_holiday_period else None,
            "school_holiday_period": {
                "start": school_holiday_period['start_date'],
                "end": school_holiday_period['end_date']
            } if school_holiday_period else None,
            "has_event": event_info['has_event'] if event_info else False,
            "has_concert": event_info['has_concert'] if event_info else False,
            "is_jmu_lecture_period": lecture_info['jmu_lecture'] if lecture_info else False,
            "is_thws_lecture_period": lecture_info['thws_lecture'] if lecture_info else False,
            "is_special_day": (
                (public_holiday is not None) or 
                (school_holiday_period is not None) or
                (event_info and event_info['has_event'])
            )
        }
    
    except ValueError:
        raise HTTPException(status_code=400, detail="Ungültiges Datumsformat. Nutze YYYY-MM-DD")

@app.get(
    "/api/all_event_dates",
    summary="Alle Events",
    description="""
    Gibt alle Events mit stündlicher Auflösung zurück.
    
    **Format:**
    - `date`: Datum im Format YYYY-MM-DD
    - `hour`: Stunde (0-23)
    - `datetime`: Datum im Format YYYY-MM-DD HH-MM-SS
    - `event`: Boolean ob Event vorhanden
    - `concert`: Boolean ob Konzert vorhanden
    
    **Beispiel:**
    GET /api/events/all_dates
    """,
    tags=["Calendar Features"]
)
async def get_all_events():
    try:
        events = redis_client.get_all_events()

        print(events)
        
        return {
            "count": len(events),
            "events": events
        }
    
    except Exception as e:
        logger.error(f"Error fetching all events: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get(
    "/api/events/{date}",
    summary="Events für ein Datum",
    description="""
    Gibt alle Events (Volksfeste, Konzerte, etc.) für ein bestimmtes Datum zurück.
    
    **Beispiel:**
    GET /api/events/2019-03-03
    **Rückgabe:**
    - Event-Name
    - Start- und Endzeit
    - Ob es ein Konzert ist
    """,
    tags=["Calendar Features"]
)
async def get_events_for_date(
    date: str = Path(..., description="Datum (YYYY-MM-DD)", example="2019-03-03")
):
    try:
        datetime.strptime(date, '%Y-%m-%d')
        
        event_info = redis_client.get_detailed_event_info(date)
        
        if not event_info or not event_info.get('has_event'):
            return {
                "date": date,
                "has_events": False,
                "events": []
            }
        
        return {
            "date": date,
            "has_events": True,
            "event_count": len(event_info['events']),
            "events": event_info['events']
        }
    
    except ValueError:
        raise HTTPException(status_code=400, detail="Ungültiges Datumsformat")

@app.get(
    "/api/pedestrians/latest/{street}",
    summary="Letzte aufgezeichnete Stunde für eine Straße",
    description="""
    Gibt das Datum und die Stunde des zuletzt aufgezeichneten Datensatzes für eine Straße zurück.

    Beispiel:
    GET /api/pedestrians/latest/Kaiserstraße
    """,
    tags=["Pedestrian Data"]
)
async def get_latest_pedestrian_record(
    street: str = Path(..., description="Straßenname", example="Kaiserstraße")
):
    if street not in ["Kaiserstraße", "Spiegelstraße", "Schönbornstraße"]:
        raise HTTPException(status_code=400, detail="Ungültiger Straßenname")

    try:
        # Hole ALLE Daten aus Redis (kann später optimiert werden)
        all_data = redis_client.get_historical_range(street, "1900-01-01", "2100-12-31")

        if not all_data:
            raise HTTPException(status_code=404, detail=f"Keine Daten für {street} gefunden")

        # Wähle den Datensatz mit dem neuesten Timestamp
        latest = max(all_data, key=lambda x: x.get("timestamp") or "")

        return {
            "street": street,
            "latest_record": {
                "date": latest.get("date"),
                "hour": int(latest.get("hour", 0)),
                "timestamp": latest.get("timestamp")
            }
        }

    except Exception as e:
        logger.error(f"Fehler beim Abrufen des letzten Datensatzes für {street}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get(
    "/api/holiday/all",
    summary="Alle Feiertage abrufen",
    description="Gibt alle Feiertage zurück (für Modelltraining)",
    tags=["Calendar Features"]
)
async def get_all_holidays():
    try:
        holidays = redis_client.get_all_public_holidays()  # implement in Redis client
        results = []

        for h in holidays:
            results.append({
                "date": h.get("date"),
                "is_holiday": int(h.get("is_holiday", False)),
                "is_nationwide": int(h.get("is_nationwide", False))
            })

        return {"count": len(results), "data": results}
    except Exception as e:
        logger.error(f"Error fetching all holidays: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get(
    "/api/lecture/all",
    summary="Alle Vorlesungsperioden abrufen",
    description="Gibt alle Vorlesungsperioden zurück (für Modelltraining)",
    tags=["Calendar Features"]
)
async def get_all_lectures():
    try:
        all_dates = redis_client.get_all_lecture_dates()  # implement in Redis client
        results = []

        for date_str in all_dates:
            info = redis_client.get_lecture_info(date_str)
            if not info:
                continue
            results.append({
                "date": date_str,
                "is_lecture_period": int(info.get("jmu_lecture", False))
            })

        return {"count": len(results), "data": results}
    except Exception as e:
        logger.error(f"Error fetching all lectures: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get(
    "/api/school-holidays",
    summary="Alle Schulferien-Perioden",
    description="""
    Gibt eine vollständige Liste aller Schulferien-Perioden zurück.
    
    **Beinhaltet:**
    - Name der Ferienperiode (z.B. Sommerferien, Weihnachtsferien)
    - Start- und Enddatum
    - Typ (school)
    - Bundesland (BY für Bayern)
    """,
    tags=["Calendar Features"]
)
async def get_all_school_holiday_periods():
    periods = redis_client.get_all_school_holiday_periods()
    return {
        "count": len(periods),
        "periods": periods
    }

@app.get(
    "/api/school-holiday/all",
    summary="Alle Schulferien abrufen",
    description="Gibt alle Schulferien zurück (für Modelltraining)",
    tags=["Calendar Features"]
)
async def get_all_school_holidays():
    try:
        school_holidays = redis_client.get_all_school_holiday_dates()  # implement in Redis client
        results = [{"date": d, "is_school_holiday": 1} for d in school_holidays]

        return {"count": len(results), "data": results}
    except Exception as e:
        logger.error(f"Error fetching all school holidays: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get(
    "/api/locations",
    summary="Alle Zählstationen",
    description="""
    Gibt detaillierte Informationen über alle Zählstationen zurück.
    
    **Beinhaltet:**
    - Standort-ID
    - Straßenname
    - GPS-Koordinaten (Latitude/Longitude)
    - GeoJSON Polygon (Zählbereich)
    
    **Verwendung:** Für Karten-Visualisierungen im Frontend
    """,
    tags=["Locations"]
)
async def get_all_locations():
    locations = redis_client.get_all_locations()
    return {
        "count": len(locations),
        "locations": locations
    }

@app.get(
    "/api/locations/{street}",
    summary="Standort einer Zählstation",
    description="""
    Gibt detaillierte Geodaten für eine spezifische Zählstation zurück.
    
    **Beispiel:**
    GET /api/locations/Kaiserstraße
    """,
    tags=["Locations"]
)
async def get_location_info(
    street: str = Path(..., description="Straßenname", example="Kaiserstraße")
):
    location = redis_client.get_location_by_street(street)
    
    if not location:
        raise HTTPException(status_code=404, detail="Zählstation nicht gefunden")
    
    return location

@app.get(
    "/api/predictions",
    summary="Vorhersagen (Coming Soon)",
    description="""
    Gibt ML-basierte Vorhersagen für Passantenströme zurück.
    
    **Status:** In Entwicklung
    
    Geplante Parameter:
    - `street`: Straßenname
    - `hours`: Anzahl Stunden in die Zukunft (1-168)
    """,
    tags=["Predictions"]
)
async def get_predictions(
    street: str = Query("Kaiserstraße", description="Straßenname"),
    hours: int = Query(24, description="Stunden voraus", ge=1, le=168)
):
    return {
        "status": "coming_soon",
        "message": "ML-Modell wird noch trainiert",
        "planned_features": [
            "Stündliche Vorhersagen",
            "Konfidenzintervalle",
            "Wetterberücksichtigung",
            "Event-Einflüsse"
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
    