# Pedestrian Prediction System

Ein System zur Vorhersage von Passantenströmen in Würzburg basierend auf historischen Daten, Wetter, Events und Kalenderinformationen.

## Inhaltsverzeichnis

- [Architektur](#architektur)
- [Schnellstart](#schnellstart)
- [Projektstruktur](#projektstruktur)
- [Entwicklung](#entwicklung)
- [API Endpoints](#api-endpoints)
- [Datenquellen](#datenquellen)
- [Troubleshooting](#troubleshooting)

---

## Architektur

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Redis     │◄─────│  FastAPI    │◄─────│  React      │
│  Database   │      │   Backend   │      │  Frontend   │
└─────────────┘      └─────────────┘      └─────────────┘
       ▲                    ▲
       │                    │
       │             ┌──────┴──────┐
       │             │             │
┌──────┴──────┐ ┌───┴────┐  ┌────┴─────┐
│ Data Loader │ │  Cron  │  │ ML Model │
│ (einmalig)  │ │  Jobs  │  │ Training │
└─────────────┘ └────────┘  └──────────┘
```

**Komponenten:**
- **Redis**: Datenbank für Zeitreihen und Features
- **FastAPI**: REST API für Datenabfragen
- **Data Loader**: Initiales Laden aller CSV-Daten
- **Scheduler**: Stündliche Updates von API-Daten
- **ML Training**: Tägliches Training der Vorhersagemodelle

---

## Schnellstart

### Voraussetzungen

- Docker & Docker Compose
- (Optional) OpenWeather API Key

### Installation

```bash
# Repository klonen
git clone <repository-url>
cd pedestrian-prediction

# CSV-Dateien im backend/data/ Ordner platzieren
mkdir -p backend/data

# .env Datei erstellen
cat > .env << EOF
OPENWEATHER_API_KEY=your_api_key_here
REDIS_HOST=redis
REDIS_PORT=6379
EOF

# System starten (baut Container, startet Redis, importiert Daten, startet Services)
docker-compose up -d

# Logs verfolgen
docker-compose logs -f
```

### Erste Schritte

```bash
# API testen
curl http://localhost:8000/

# Swagger UI öffnen
open http://localhost:8000/docs

# Redis Insight öffnen
open http://localhost:8001
```

---

## Projektstruktur

```
pedestrian-prediction/
├── backend/
│   ├── api/
│   │   ├── main.py              # FastAPI Endpoints
│   │   └── schemas.py           # Pydantic Models
│   ├── data/                    # CSV Dateien (nicht im Git)
│   │   ├── bavarian_public_holidays_daily.csv
│   │   ├── bavarian_public_holidays.csv
│   │   ├── bavarian_school_holidays_daily.csv
│   │   ├── bavarian_school_holidays.csv
│   │   ├── events_daily.csv
│   │   ├── events.csv
│   │   ├── lectures_daily.csv
│   │   ├── lectures.csv
│   │   ├── counterGeoLocations.csv
│   │   └── dataAllStreets.csv
│   ├── data_ingestion/
│   │   ├── api_fetcher.py       # Holt Daten von API
│   │   ├── weather_fetcher.py   # OpenWeather Integration
│   │   └── scheduler.py         # Cron Jobs
│   ├── database/
│   │   └── redis_client.py      # Redis Wrapper
│   ├── ml/
│   │   ├── feature_engineering.py
│   │   ├── train.py             # Model Training
│   │   └── predict.py           # Predictions
│   ├── scripts/
│   │   ├── initial_load.py      # Master Import Script
│   │   ├── import_*.py          # Einzelne Import Scripts
│   │   └── migrate_*.py         # Migrations
│   ├── config.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                    # React App (TODO)
├── docker-compose.yml
├── .env
└── README.md
```

---

## Entwicklung

### Container Management

```bash
# Alle Services starten
docker-compose up -d

# Einzelnen Service neu starten
docker-compose restart api
docker-compose restart scheduler

# Mit Rebuild (nach Code-Änderungen)
docker-compose up -d --build api

# Alle Services stoppen
docker-compose down

# Mit Datenbank-Löschung
docker-compose down -v
```

### Logs anschauen

```bash
# Alle Logs live
docker-compose logs -f

# Nur API
docker-compose logs -f api

# Letzte 100 Zeilen
docker-compose logs --tail=100 api

# Data Loader (auch wenn gestoppt)
docker-compose logs data_loader
```

### Daten neu importieren

```bash
# Nur fehlende Daten importieren
docker-compose run --rm data_loader

# Alles löschen und neu importieren
docker-compose down -v
docker-compose up -d
```

### In Container einsteigen

```bash
# API Container
docker-compose exec api bash

# Redis CLI
docker-compose exec redis redis-cli

# Python Shell im Container
docker-compose exec api python
```

### Redis Daten prüfen

```bash
docker-compose exec redis redis-cli

# Im Redis CLI:
> KEYS pedestrian:hourly:Kaiserstraße:*
> HGETALL pedestrian:hourly:Kaiserstraße:2019-04-02:18
> SMEMBERS holidays:all_dates
> DBSIZE
```

---

## API Endpoints

### Base URL
`http://localhost:8000`

### Dokumentation
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### Wichtige Endpoints

**Health Check**
```bash
GET /
```

**Straßen abrufen**
```bash
GET /api/streets
```

**Historische Daten**
```bash
GET /api/pedestrians/historical?street=Kaiserstraße&start_date=2019-04-02&end_date=2019-04-05
```

**Aktuelle Daten**
```bash
GET /api/pedestrians/current?street=Kaiserstraße
```

**Predictions**
```bash
GET /api/pedestrians/predictions?street=Kaiserstraße&hours=24
```

**Statistiken**
```bash
GET /api/statistics/Kaiserstraße?days_back=30
```

**Kalender-Informationen (kombiniert)**
```bash
GET /api/calendar/2019-04-02
```

**Events**
```bash
GET /api/events/2019-03-03
```

**Locations (Geodaten)**
```bash
GET /api/locations
GET /api/locations/Kaiserstraße
```

**Straßen-Vergleich**
```bash
GET /api/compare?date=2019-04-02&hour=18
```

---

## Datenquellen

### Erforderliche CSV-Dateien

Alle Dateien müssen in `backend/data/` liegen:

| Datei | Beschreibung | Zeilen | Format |
|-------|--------------|--------|--------|
| `bavarian_public_holidays_daily.csv` | Tägliche Feiertage | ~365/Jahr | date,public_holiday,nationwide |
| `bavarian_public_holidays.csv` | Detaillierte Feiertage | ~15/Jahr | date,name,regionalScope,... |
| `bavarian_school_holidays_daily.csv` | Tägliche Schulferien | ~365/Jahr | date,school_holiday |
| `bavarian_school_holidays.csv` | Ferienperioden | ~7/Jahr | name,startDate,endDate,... |
| `events_daily.csv` | Tägliche Events | ~8760/Jahr | date,event,concert |
| `events.csv` | Event-Details | ~100/Jahr | name,start,end,concert |
| `lectures_daily.csv` | Vorlesungszeiten täglich | ~365/Jahr | date,lecture_period_jmu |
| `lectures.csv` | Vorlesungsperioden | ~10/Jahr | start,end,jmu,thws |
| `counterGeoLocations.csv` | Zählstationen-Geodaten | 3 | ID,streetname,GeoShape,... |
| `dataAllStreets.csv` | Historische Passantendaten | ~26k | id,streetname,date,hour,... |

### Externe APIs

**Passantendaten API**
- Base URL: `https://data.wuerzburg.de`
- Endpoint: `/api/explore/v2.1/catalog/datasets/passantenzaehlung_stundendaten/records`
- Wird automatisch stündlich abgerufen

**OpenWeather API** (optional)
- Für Wettervorhersagen
- API Key in `.env` setzen

---

## Redis Datenstruktur

### Passantendaten
```
pedestrian:hourly:{street}:{date}:{hour} → Hash
```

### Kalender-Features
```
holiday:{date} → Hash
holiday:detail:{date} → Hash
school_holiday:{date} → Hash
school_holiday:day:{date} → Hash
event:detail:hour:{date}:{hour} → Hash
lecture:detail:{date} → Hash
```

### Indizes (Sets für schnelle Lookups)
```
holidays:all_dates → Set
school_holidays:all → Set
events:all_dates → Set
lectures:jmu:detailed → Set
```

### Locations
```
location:id:{id} → Hash
location:name:{street} → Hash
```

### Predictions
```
prediction:{street}:{date}:{hour} → Hash (TTL: 30 Tage)
```

---

## Troubleshooting

### Port bereits belegt

```bash
# Finde Prozess auf Port 8000
lsof -i :8000

# Oder ändere Port in docker-compose.yml
ports:
  - "8080:8000"  # Extern 8080, intern 8000
```

### Redis Verbindung fehlgeschlagen

```bash
# Prüfe Redis
docker-compose exec redis redis-cli ping
# Sollte "PONG" zurückgeben

# Logs prüfen
docker-compose logs redis
```

### Data Loader zeigt keine Logs

```bash
# Manuell ausführen
docker-compose run --rm data_loader

# Oder im Vordergrund
docker-compose up data_loader
```

### Python Module nicht gefunden

```bash
# Container neu bauen
docker-compose build --no-cache api
docker-compose up -d
```

### API lädt Änderungen nicht

```bash
# Prüfe ob --reload aktiv ist
docker-compose logs api | grep reload

# Manuell neu starten
docker-compose restart api
```

### Daten importieren dauert zu lange

```bash
# API-Limit erreicht? Prüfe Logs
docker-compose logs data_loader | grep Error

# Reduziere Jahre in initial_load.py
# Ändere: for year in ["2024", "2025"]
# Zu: for year in ["2025"]
```

---

## Nützliche Befehle

### Entwicklung

```bash
# Hot Reload funktioniert automatisch für API
# Bei Scheduler-Änderungen:
docker-compose restart scheduler

# Requirements hinzugefügt?
docker-compose up -d --build api scheduler

# Alle Container neu bauen
docker-compose build --no-cache
```

### Debugging

```bash
# Python Shell im Container
docker-compose exec api python

# Redis Daten inspizieren
docker-compose exec redis redis-cli
> KEYS *
> DBSIZE
> MEMORY USAGE pedestrian:hourly:Kaiserstraße:2019-04-02:18

# Container Stats
docker stats
```

### Produktion

```bash
# Ohne Volume Mounts für Production
# In docker-compose.yml volumes: auskommentieren

# Mit resource limits
docker-compose up -d --scale scheduler=1 --scale api=3
```

---

## Nächste Schritte

- [ ] ML Model implementieren (`ml/train.py`, `ml/predict.py`)
- [ ] Weather Fetcher vervollständigen (`data_ingestion/weather_fetcher.py`)
- [ ] React Frontend erstellen
- [ ] Scheduler Jobs aktivieren (stündlich, täglich)
- [ ] Monitoring & Logging verbessern
- [ ] Tests schreiben
- [ ] CI/CD Pipeline
- [ ] Deployment-Strategie (Docker Swarm / Kubernetes)

---

## Support

Bei Problemen:
1. Logs prüfen: `docker-compose logs -f`
2. Redis prüfen: `docker-compose exec redis redis-cli`
3. Container Status: `docker-compose ps`
4. Swagger UI für API-Tests: http://localhost:8000/docs