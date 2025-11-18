# Pedestrian Prediction System

Dieses Repository stellt ein vollständiges Passanten-Analytics-System für Würzburg bereit. Es kombiniert historische Messungen, aktuelle Datenfeeds, Wettervorhersagen sowie Event- und Kalenderinformationen, um Prognosen zu erzeugen und sie in einem modernen Dashboard aufzubereiten.

Das Projekt besteht aus einem FastAPI-Backend mit Redis als Zeitreihen-Store, einem Next.js 15 Frontend für Visual Analytics und einem ML-Stack zur Generierung stündlicher Vorhersagen (bis zu acht Tage in die Zukunft).

## Highlights

- Echtzeit- und historische Visualisierung mit Next.js 15, React 19, Tailwind und shadcn/ui (`frontend/components/dashboard.tsx`)
- Aggregierte Statistiken, Trendprognosen, Heatmaps und Kalenderereignisse in einer Oberfläche (`frontend/components/charts`, `statistics`, `calendar`)
- FastAPI-Backend mit umfangreichen Endpoints für Zeitreihen, Events, Kalender und Standortdaten (`backend/api/main.py`)
- Automatisierte Daten-Pipeline inkl. CSV-Import, Open-Data-Fetcher und stündlicher Scheduler für ML-Vorhersagen (`backend/scripts/initial_load.py`, `data_ingestion/scheduler.py`)
- Containerisierte Laufzeit mittels `compose.yaml` (Redis Stack, Data Loader, Scheduler, API)

## Gesamtarchitektur

```
                   ┌──────────────────────────┐
                   │       Next.js 15         │
                   │  (App Router Dashboard)  │
                   └────────────┬─────────────┘
                                │ REST
                                ▼
┌─────────────────┐    ┌───────────────────────┐
│  Redis Stack    │◄──►│ FastAPI (`api/main`)  │
│  (Zeitreihen &  │    │  - Daten & Prognosen  │
│   Feature Store)│    │  - Swagger / ReDoc    │
└────────┬────────┘    └───────────┬───────────┘
         ▲                         │
         │                         │ ruft
         │ writes/reads            │
┌────────┴────────┐        ┌───────┴────────────┐
│ Data Loader     │        │ Scheduler & ML      │
│ (`scripts/...`) │        │ (`data_ingestion/`  │
│  - CSV Import   │        │  + `ML/predict.py`) │
│  - API Fetcher  │        │  - Stündliche Jobs  │
└─────────────────┘        └─────────────────────┘
```

## Repository Aufbau

```
backend/
  api/                  # FastAPI App & Endpoints
  database/             # Redis Client & Zugriff
  data_ingestion/       # Open-Data Fetcher & Scheduler
  ML/                   # Training & Prediction Pipelines
  scripts/              # CSV-Import, Initial Loader, Indexbuilder
  data/                 # Erwartete CSV-Dateien (nicht eingecheckt)
  requirements.txt      # Python-Abhängigkeiten
  Dockerfile

frontend/
  app/                  # Next.js App Router Einstieg
  components/           # Dashboard, Charts, Filter, UI
  lib/                  # API-Client, Types, Hooks
  public/
  package.json

compose.yaml            # Docker Compose Stack (Redis + Backend Services)
```

## Schnellstart

### Voraussetzungen

- Docker & Docker Compose (oder Podman Compose)
- Node.js ≥ 20 (für lokale Frontend-Entwicklung mit Turbopack)
- Python 3.11 (nur falls Backend ohne Container betrieben werden soll)
- Eigener OpenWeather API-Key für Prognosen (kostenlos erhältlich unter https://openweathermap.org/)

### 1. Umgebungsvariablen anlegen

Erstelle im Projektroot eine `.env` (für Backend & Compose):

```bash
OPENWEATHER_API_KEY=<dein_openweather_api_key>
REDIS_HOST=redis
REDIS_PORT=6379
```

Für das Frontend wird eine `frontend/.env.local` benötigt:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 2. CSV-Daten bereitstellen

Lege die Rohdaten in `backend/data/` ab. Erwartet werden u. a.:

- `dataAllStreets.csv` – historische Passantenzählungen (stündlich)
- `counterGeoLocations.csv` – Zählstellen inklusive Geometrie
- `bavarian_public_holidays*.csv`, `bavarian_school_holidays*.csv`
- `events.csv`, `events_daily.csv`
- `lectures.csv`, `lectures_daily.csv`

Siehe Abschnitt [Datenpipeline & Machine Learning](#datenpipeline--machine-learning) für Details zu den Formaten.

### 3. Stack starten (empfohlener Weg)

```bash
# Repository klonen
git clone <repository-url>
cd PedestrainDashboard - Kopie

# Container bauen & starten
docker compose up -d --build

# Logs ansehen
docker compose logs -f --tail=50
```

Nach wenigen Minuten (Initialimport + erste Prognose) stehen folgende URLs zur Verfügung:

- Dashboard: http://localhost:3000
- FastAPI + Swagger: http://localhost:8000 /docs
- Redis Insight (Visualisierung der Keys): http://localhost:8001

Compose-Services:

- `redis` – Redis Stack (inkl. Insight UI)
- `data_loader` – einmaliger CSV-/API-Import (`scripts/initial_load.py`)
- `scheduler` – stündliche Updates + ML-Vorhersagen (`data_ingestion/scheduler.py`)
- `api` – FastAPI mit `uvicorn --reload`

### 4. Frontend im Dev-Modus (optional)

```bash
cd frontend
npm install
npm run dev  # läuft auf http://localhost:3000
```

Durch das Volume-Mounting in `compose.yaml` können Frontend-/Backend-Dateien direkt bearbeitet werden; Hot Reload sorgt für schnelle Iteration.

## Manuelle Entwicklung ohne Docker

1. Redis starten (z. B. lokal `redis-stack` auf Port 6379/8001)
2. Backend-Abhängigkeiten installieren:
   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
3. Initiale Daten laden:
   ```bash
   python scripts/initial_load.py
   ```
4. API starten:
   ```bash
   uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
   ```
5. Scheduler (für kontinuierliche Updates) separat ausführen:
   ```bash
   python -m data_ingestion.scheduler
   ```
6. Frontend wie oben starten (`npm run dev`).

## Backend Komponenten

- `backend/api/main.py`: Haupt-FastAPI-Anwendung mit Endpoints für Historie, Prognosen, Kalenderdaten, Locations und Statusinformationen. Enthält CORS-Setup für lokale Entwicklung.
- `backend/database/redis_client.py`: High-Level-Wrapper für Redis, inkl. Indexierung via Sorted Sets für schnelle Bereichsabfragen.
- `backend/scripts/initial_load.py`: Orchestriert CSV-Importe, ruft Open-Data-API, baut Redis-Indizes und erzeugt initiale Prognosen.
- `backend/data_ingestion/api_fetcher.py`: Holt gestaffelte Datensätze aus dem Würzburg Open-Data-Portal (monatliche Pagination, Bulk-Insert in Redis).
- `backend/data_ingestion/scheduler.py`: APScheduler-basierter Jobrunner (Fetch neuester Messwerte, generiere ML-Prognosen, Wartung).
- `backend/ML/train.py`: Modelltraining (XGBoost/LightGBM) auf Basis der Daten aus der API. Beinhaltet umfangreiche Feature-Engineering-Funktionen (Zeit, Wetter, Events, Ferien).
- `backend/ML/predict.py`: Lädt ein trainiertes Modell, generiert 8-Tages-Vorhersagen (unter Einbezug der OpenWeather-Vorhersage) und persistiert sie in Redis (`pedestrian:hourly:prediction:*`).

## API Überblick

| Endpoint | Beschreibung |
| --- | --- |
| `GET /` | Health-Check inkl. Endpoint-Referenzen |
| `GET /api/streets` | Liste aller Zählstellen + Koordinaten |
| `GET /api/pedestrians/historical` | Historische Messdaten für Straße + Zeitraum |
| `GET /api/pedestrians/detailed/{street}/{date}/{hour}` | Detailansicht inkl. Wetter, Richtungen, Incidents |
| `GET /api/pedestrians/predictions` | Prognosen für Straße(n) und Zeitraum |
| `GET /api/pedestrians/latest/{street}` | Letztes verfügbares Messintervall |
| `GET /api/calendar/{date}` | Feiertage, Schulferien, Vorlesungsperioden, Events |
| `GET /api/events/{date}` | Tagesereignisse mit Details |
| `GET /api/locations(/…)` | Zählstellen-Metadaten (IDs, GeoJSON) |
| `GET /api/holiday/all`, `/api/school-holiday/all`, `/api/lecture/all` | Rohdaten-Exports für ML |
| `GET /api/predictions/status` | Coverage & Zeitstempel der vorhandenen Prognosen |

Swagger und ReDoc sind unter `/docs` bzw. `/redoc` erreichbar.

## Frontend Funktionen

Hauptkomponente: `frontend/components/dashboard.tsx`

- **Filter** (`filters/street-filter.tsx`, `filters/date-filter.tsx`): Auswahl einzelner Straßen oder Aggregation über alle Straßen, Zeitfenster (Tag/Woche/Monat) mit Datumspicker.
- **KPI-Karten** (`statistics/statistics-cards.tsx`): Gesamtanzahl (inkl. live Prognoseauffüllung), Peak-Analysen (Tag = Peak-Stunde, Woche/Monat = Spitzen-Tag), Trend-Vorhersage für konfigurierbare Zeitfenster, Wetterzusammenfassung.
- **Zeitreihe & Vergleich** (`charts/data-visualization.tsx`): Wechsel zwischen stündlicher Ansicht, Tagesbalken, Vergleich mit Vorperiode (Vortag, Vorwoche, Vormonat, Vorjahr), Integration von Prognosewerten (gestrichelte Linien, Einblendung/Checkboxen).
- **Heatmap** (`charts/heatmap-visualization.tsx`): Tages-/Wochen-Pattern, kombiniert historische Werte mit zukünftigen Prognosen.
- **Kalender-Widget** (`calendar/calendar-component.tsx`): Konsolidierte Ansicht aus Feiertagen, Ferien, Vorlesungen und Events (inkl. anstehender Events).
- **Dark-/Lightmode** (`components/theme-toggle.tsx`) und globale Layouts (`app/layout.tsx`, `app/globals.css`).
- **Datenzugriff**: TanStack Query (`components/providers.tsx`, `lib/api.ts`) mit Caching, Fehlerhandling und Utility-Transformationen (`transformToHourlyData`, `transformToDailyData`, etc.).

## Datenpipeline & Machine Learning

1. **Initial Load (`scripts/initial_load.py`)**
   - CSV-Dateien in Redis importieren (`scripts/import_*.py`)
   - Historische Daten über Open-Data-API (Jahr 2024/2025) in Redis laden
   - Redis-Indizes (Sorted Sets) aufbauen (`scripts/build_indexes.py`)
   - Erste Prognosen erzeugen (`ML/predict.run_predictions_and_store`)

2. **Regelmäßige Updates (`data_ingestion/scheduler.py`)**
   - `fetch_hourly_updates`: Holt die letzten Stunden Messdaten (pro Straße) und schreibt sie via `PedestrianRedisClient`.
   - `fetch_predictions`: Triggert `ML/predict.py`, nutzt OpenWeather Forecast (`fetch_weather_forecast`) und verteilt Prognosen auf alle Straßen.

3. **Machine Learning**
   - `ML/train.py`: Lädt via API alle historischen Daten, reichert sie mit Events, Feiertagen, Vorlesungszeiten und Wettermerkmalen an, trainiert XGBoost/LightGBM und speichert Modell + Feature-Liste.
   - `ML/predict.py`: Nutzt das Modell, generiert `pedestrian:hourly:prediction:{street}:{date}:{hour}` Keys mit TTL und pflegt Status-Endpunkt (`get_prediction_status`).

4. **Redis-Datenschema (Auszug)**
   - Messwerte: `pedestrian:hourly:{street}:{date}:{hour}`
   - Indizes: `pedestrian:index:{street}` (Sorted Set nach Timestamp)
   - Prognosen: `pedestrian:hourly:prediction:{street}:{date}:{hour}`
   - Kalender: `holiday:*`, `school_holiday:*`, `event:*`, `lecture:*`
   - Locations: `location:name:{street}`, `location:id:{id}`

## Entwicklungs-Workflows

### Backend

```bash
# API lokal starten
uvicorn api.main:app --reload --port 8000

# Daten erneut importieren (z. B. nach CSV-Updates)
python scripts/initial_load.py

# Scheduler in separatem Terminal
python -m data_ingestion.scheduler
```

### Frontend

```bash
cd frontend
npm run lint     # ESLint (nutzt eslint.config.mjs)
npm run build    # Production Check inkl. TypeScript
```

### Tests

Aktuell existieren keine automatisierten Tests im Repo. Empfohlen wird:

- Backend: Pytest + httpx-Client (`FastAPI TestClient`) für zukünftige Erweiterungen
- Frontend: Playwright oder Cypress für End-to-End, Vitest/RTL für Komponenten

## Troubleshooting

- **Redis nicht erreichbar**: Verifiziere `REDIS_HOST`/`REDIS_PORT`, prüfe `docker compose ps`, nutze `docker compose logs redis`.
- **OpenWeather Key fehlt/ungültig**: Prognosen schlagen fehl ⇒ Scheduler-Log prüfen (`prediction update failed`). Gültigen Key in `.env` setzen.
- **Frontend spricht falsche API an**: `frontend/.env.local` prüfen; `NEXT_PUBLIC_API_URL` muss exakt zum Backend passen.
- **Langsame API beim Initialimport**: `scripts/initial_load.py` ruft Jahr 2024 & 2025 ab. Für schnellere Tests kannst du `for year in ["2024", "2025"]` temporär reduzieren.
- **Port-Konflikte**: `docker compose` lässt Ports konfigurieren (`compose.yaml`). Alternativ lokale Ports anpassen (`PORT=3001 npm run dev`, `uvicorn --port 8080`).
- **Lange Laufzeit ML-Pipeline**: `ML/train.py` holt sämtliche Daten via API. Für inkrementelles Training Filter/Jahresauswahl anpassen.

## Contributing

Pull-Requests sind willkommen! Bitte beachte:

1. Feature-Branch nach Konvention (`feature/...`, `fix/...`, `docs/...`).
2. Konventionelle Commit-Messages (z. B. `feat: add prediction overlay`).
3. Linting & Builds lokal ausführen (`npm run lint`, `npm run build`, `uvicorn` Smoke-Test).
4. README oder Dokumentation aktualisieren, falls Verhalten sich ändert.
5. Keine Secrets, CSVs oder `node_modules` einchecken.

## Weiterführende Links

- Next.js Dokumentation: https://nextjs.org/docs
- FastAPI Dokumentation: https://fastapi.tiangolo.com/
- Redis Stack: https://redis.io/docs/
- TanStack Query: https://tanstack.com/query/latest
- shadcn/ui: https://ui.shadcn.com/
- Würzburg Open Data Portal: https://data.wuerzburg.de/

Bei Fragen: Logs prüfen (`docker compose logs -f`), Swagger-UI verwenden oder Redis Insight auf http://localhost:8001 öffnen.
# Pedestrian Prediction System

Ein umfassendes System zur Analyse und Vorhersage von Passantenströmen in Würzburg. Das System kombiniert historische Daten, Wetterbedingungen, Events und Kalenderinformationen, um präzise Vorhersagen zu treffen und diese in einem interaktiven Dashboard zu visualisieren.

**Features:**
- 📊 **Interaktives Dashboard**: Visualisierung von historischen und prognostizierten Passantenzahlen
- 🔮 **Predictive Analytics**: ML-basierte Vorhersagen für verschiedene Zeiträume
- 📅 **Kalender-Integration**: Berücksichtigung von Feiertagen, Schulferien und Events
- 🌤️ **Wetter-Integration**: OpenWeather API für Wettereinflüsse
- 🎨 **Modern UI**: Next.js 15 mit Dark Mode, Responsive Design
- ⚡ **High Performance**: Redis für schnelle Datenabfragen, TanStack Query für optimales Caching

## Inhaltsverzeichnis

- [Architektur](#architektur)
- [Schnellstart](#schnellstart)
  - [Voraussetzungen](#voraussetzungen)
  - [Installation](#installation)
  - [Erste Schritte](#erste-schritte)
  - [Environment Variables](#environment-variables)
- [Projektstruktur](#projektstruktur)
- [Entwicklung](#entwicklung)
  - [Frontend Entwicklung](#frontend-entwicklung)
  - [Container Management](#container-management)
  - [Git Workflow & Kollaboration](#git-workflow--kollaboration)
- [API Endpoints](#api-endpoints)
- [Datenquellen](#datenquellen)
- [Redis Datenstruktur](#redis-datenstruktur)
- [Troubleshooting](#troubleshooting)
  - [Frontend-Probleme](#frontend-probleme)
  - [Backend-Probleme](#backend-probleme)
  - [Podman-spezifische Probleme](#podman-spezifische-probleme)
- [Nächste Schritte](#nächste-schritte)
- [Contributing](#contributing)
- [Support & Kontakt](#support--kontakt)

---

## Architektur

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Redis     │◄─────│  FastAPI    │◄─────│   Next.js   │
│  Database   │      │   Backend   │      │  Frontend   │
└─────────────┘      └─────────────┘      └─────────────┘
      ▲                    ▲
      │                    │
      │            ┌───────┴─────┐
      │            │             │
┌──────┴──────┐ ┌───┴────┐  ┌─-───┴────┐
│ Data Loader │ │  Cron  │  │ ML Model │
│ (einmalig)  │ │  Jobs  │  │ Training │
└─────────────┘ └────────┘  └──────────┘
```

**Komponenten:**
- **Redis**: Datenbank für Zeitreihen und Features
- **FastAPI**: REST API für Datenabfragen und Datenverarbeitung
- **Next.js Frontend**: Moderne React-Anwendung mit App Router, TypeScript und TanStack Query
- **Data Loader**: Initiales Laden aller CSV-Daten
- **Scheduler**: Stündliche Updates von API-Daten
- **ML Training**: Tägliches Training der Vorhersagemodelle

**Tech Stack:**
- **Backend**: Python, FastAPI, Redis
- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui
- **Container**: Docker / Podman mit Compose

---

## Schnellstart

### Voraussetzungen

**Container Runtime:**
- Docker & Docker Compose **oder** Podman & Podman Compose
  - [Podman Installation](https://podman.io/getting-started/installation) (Alternative zu Docker)

**Für Frontend-Entwicklung:**
- [Node.js LTS](https://nodejs.org/) (v20.x oder höher empfohlen)
- npm oder pnpm (kommt mit Node.js)

**Optional:**
- OpenWeather API Key für Wettervorhersagen
- Git für Versionskontrolle

### Installation

```bash
# Repository klonen
git clone <repository-url>
cd PedestrainDashboard

# CSV-Dateien im backend/data/ Ordner platzieren
mkdir -p backend/data
# (Dateien manuell in backend/data/ kopieren)

# .env Datei umbenennen von **.env.local** zu **.env**
OPENWEATHER_API_KEY=your_api_key_here
REDIS_HOST=redis
REDIS_PORT=6379

# Backend starten (baut Container, startet Redis, importiert Daten)
podman compose up -d --build

# Frontend Dependencies installieren
cd frontend
npm install

# Frontend .env.local erstellen:
NEXT_PUBLIC_API_URL=http://localhost:8000

# Frontend im Development-Modus starten
npm run dev

# Logs vom Backend verfolgen (in Podman Desktop)

**Alternative mit Docker:**
```bash
# Ersetze 'podman compose' mit 'docker-compose' in allen Befehlen
docker-compose up -d --build
```

### Erste Schritte

Nach erfolgreicher Installation sind folgende Services verfügbar:

```bash
# Frontend öffnen
open http://localhost:3000

# Backend API testen
curl http://localhost:8000/

# Swagger UI öffnen (API Dokumentation)
open http://localhost:8000/docs

# Redis Insight öffnen (Datenbank Explorer)
open http://localhost:8001
```

**Verfügbare URLs:**
- **Frontend Dashboard**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Dokumentation (Swagger)**: http://localhost:8000/docs
- **API Dokumentation (ReDoc)**: http://localhost:8000/redoc
- **Redis Insight**: http://localhost:8001

### Environment Variables

**Backend (.env im Root-Verzeichnis):**
```bash
# OpenWeather API (optional, für Wettervorhersagen)
OPENWEATHER_API_KEY=your_api_key_here

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
```

**Frontend (frontend/.env.local):**
```bash
# Backend API URL
NEXT_PUBLIC_API_URL=http://localhost:8000

# Optional: Analytics, Monitoring, etc.
# NEXT_PUBLIC_ANALYTICS_ID=your_id_here
```

**Hinweise:**
- `.env` Dateien nicht ins Git committen (bereits in `.gitignore`)
- Für Production: Sichere Werte verwenden
- `NEXT_PUBLIC_*` Prefix für öffentlich zugängliche Variablen im Frontend

---

## Projektstruktur

```
PedestrainDashboard-main/
├── backend/
│   ├── api/
│   │   ├── main.py              # FastAPI Endpoints
│   │   └── __init__.py
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
│   ├── ML/
│   │   ├── train.py             # Model Training
│   │   ├── predict.py           # Predictions
│   │   └── evaluate.py          # Model Evaluation
│   ├── scripts/
│   │   ├── initial_load.py      # Master Import Script
│   │   ├── import_*.py          # Einzelne Import Scripts
│   │   └── build_indexes.py     # Index Building
│   ├── config.py                # Configuration
│   ├── requirements.txt         # Python Dependencies
│   └── Dockerfile
├── frontend/
│   ├── app/                     # Next.js App Router
│   │   ├── page.tsx             # Dashboard Page
│   │   ├── layout.tsx           # Root Layout
│   │   ├── globals.css          # Global Styles
│   │   └── favicon.ico
│   ├── components/
│   │   ├── dashboard.tsx        # Main Dashboard Component
│   │   ├── charts/
│   │   │   └── data-visualization.tsx  # Chart Components
│   │   ├── filters/
│   │   │   ├── date-filter.tsx         # Date Selection
│   │   │   └── street-filter.tsx       # Street Selection
│   │   ├── statistics/
│   │   │   └── statistics-cards.tsx    # Stats Display
│   │   ├── calendar/
│   │   │   └── calendar-component.tsx  # Calendar Widget
│   │   ├── ui/                  # shadcn/ui Components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── select.tsx
│   │   │   └── ...
│   │   ├── providers.tsx        # React Query Provider
│   │   └── theme-toggle.tsx     # Dark Mode Toggle
│   ├── lib/
│   │   ├── api.ts               # API Client
│   │   ├── types.ts             # TypeScript Types
│   │   ├── utils.ts             # Utility Functions
│   │   └── hooks/
│   │       └── use-pedestrian-data.ts  # Data Fetching Hook
│   ├── public/                  # Static Assets
│   ├── package.json             # Node Dependencies
│   ├── tsconfig.json            # TypeScript Config
│   ├── next.config.ts           # Next.js Config
│   └── tailwind.config.ts       # Tailwind CSS Config
├── compose.yaml                 # Docker Compose Configuration
├── .env                         # Environment Variables
└── README.md
```

### Frontend Architektur

Das Frontend ist mit Next.js 15 und dem App Router aufgebaut:

**Komponentenstruktur:**
```
Dashboard (Main Component)
├── DateFilter          → Datumsauswahl mit Calendar Picker
├── StreetFilter        → Dropdown für Straßenauswahl
├── StatisticsCards     → KPI-Anzeigen (Durchschnitt, Peak, Trend)
├── DataVisualization   → Recharts für Diagramme
│   ├── LineChart       → Zeitverlauf
│   ├── BarChart        → Stundenvergleich
│   └── AreaChart       → Predictions mit Confidence Interval
└── CalendarComponent   → Event-Übersicht
```

**State Management & Data Flow:**
```
TanStack Query (React Query)
├── usePedestrianData() → Custom Hook für alle API Calls
├── Cache-Strategie      → 5 Min Stale Time, Auto-Refetch
└── Optimistic Updates   → Sofortige UI-Updates
```

**API-Integration:**
```typescript
// lib/api.ts - Zentrale API-Client
export const fetchHistoricalData = async (street: string, dateRange: DateRange)
export const fetchCurrentData = async (street: string)
export const fetchPredictions = async (street: string, hours: number)
export const fetchStatistics = async (street: string, daysBack: number)
```

**Styling:**
- **Tailwind CSS**: Utility-First Styling
- **shadcn/ui**: Accessible, customizable UI-Komponenten
- **next-themes**: Dark/Light Mode mit System-Preference
- **CSS Variables**: Konsistentes Theming

---

## Entwicklung

### Frontend Entwicklung

**Development Server starten:**
```bash
cd frontend
npm run dev
```

Das Frontend läuft auf http://localhost:3000 mit Hot Reload.

**Verfügbare Scripts:**
```bash
npm run dev        # Development Server (Port 3000)
npm run build      # Production Build
npm run start      # Production Server starten
npm run lint       # ESLint ausführen
```

**Wichtige Technologien:**
- **Next.js 15**: App Router, Server Components, Turbopack
- **React 19**: Neueste Features
- **TypeScript**: Type-safe Development
- **TanStack Query**: Data Fetching & Caching
- **Tailwind CSS**: Utility-First Styling
- **shadcn/ui**: Wiederverwendbare UI-Komponenten
- **Recharts**: Datenvisualisierung
- **next-themes**: Dark Mode Support

**Komponenten hinzufügen:**
```bash
# shadcn/ui Komponenten installieren
npx shadcn@latest add <component-name>

# Beispiel:
npx shadcn@latest add dialog
npx shadcn@latest add dropdown-menu
```

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

### Git Workflow & Kollaboration

**Repository Setup:**
```bash
# Repository klonen
git clone <repository-url>
cd PedestrainDashboard-main

# Upstream remote hinzufügen (falls Fork)
git remote add upstream <original-repository-url>
```

**Branch-Strategie:**

Wir verwenden einen Feature-Branch-Workflow:

```bash
# Immer vom aktuellen main starten
git checkout main
git pull origin main

# Neuen Feature-Branch erstellen
git checkout -b <branch-typ>/<kurze-beschreibung>
```

**Branch-Naming Convention:**

Format: `<typ>/<kurze-beschreibung>`

**Typen:**
- `feature/` - Neue Features (z.B. `feature/user-authentication`)
- `fix/` - Bugfixes (z.B. `fix/api-error-handling`)
- `refactor/` - Code-Refactoring (z.B. `refactor/redis-client`)
- `docs/` - Dokumentation (z.B. `docs/update-readme`)
- `style/` - Styling-Änderungen (z.B. `style/dashboard-layout`)
- `test/` - Tests hinzufügen (z.B. `test/api-endpoints`)
- `chore/` - Maintenance (z.B. `chore/update-dependencies`)

**Beispiele:**
```bash
git checkout -b feature/weather-predictions
git checkout -b fix/date-filter-bug
git checkout -b docs/api-documentation
git checkout -b refactor/database-queries
```

**Entwicklungs-Workflow:**
```bash
# Änderungen machen...

# Status prüfen
git status

# Dateien zum Staging hinzufügen
git add .

# Commit mit aussagekräftiger Nachricht
git commit -m "feat: add weather prediction endpoint"

# Branch pushen
git push origin <branch-name>

# Falls Branch noch nicht auf Remote existiert:
git push -u origin <branch-name>
```

**Commit Message Convention:**

Format: `<typ>: <kurze beschreibung>`

**Typen:**
- `feat:` - Neues Feature
- `fix:` - Bugfix
- `docs:` - Dokumentationsänderung
- `style:` - Code-Formatierung, Styling
- `refactor:` - Code-Umstrukturierung
- `test:` - Tests hinzufügen/ändern
- `chore:` - Maintenance, Dependencies

**Beispiele:**
```bash
git commit -m "feat: add date range filter component"
git commit -m "fix: resolve API connection timeout"
git commit -m "docs: update installation instructions"
git commit -m "refactor: improve data fetching logic"
```

**Pull Request erstellen:**

1. Push deinen Branch zu GitHub
2. Gehe zu GitHub und erstelle einen Pull Request
3. Beschreibe deine Änderungen ausführlich
4. Verlinke relevante Issues
5. Warte auf Code Review
6. Nimm Feedback auf und update bei Bedarf

**Branch aktuell halten:**
```bash
# Main Branch updaten
git checkout main
git pull origin main

# Änderungen in deinen Branch mergen
git checkout <dein-branch>
git merge main

# Oder mit rebase (sauberer)
git rebase main
```

**Best Practices:**
- ✅ Kleine, fokussierte Commits
- ✅ Aussagekräftige Commit-Messages
- ✅ Regelmäßig pushen
- ✅ Branch vor PR mit main synchronisieren
- ✅ Code Reviews durchführen
- ✅ Tests schreiben für neue Features
- ❌ Nie direkt auf main pushen
- ❌ Keine riesigen Commits mit vielen Änderungen
- ❌ Keine generierten Dateien committen (node_modules, .env, etc.)

**Hilfreiche Befehle:**
```bash
# Änderungen verwerfen
git checkout -- <datei>
git restore <datei>

# Letzten Commit rückgängig machen (lokal)
git reset --soft HEAD~1

# Branch löschen (lokal)
git branch -d <branch-name>

# Branch löschen (remote)
git push origin --delete <branch-name>

# Stash (Änderungen temporär speichern)
git stash
git stash pop

# Commit-Historie ansehen
git log --oneline --graph
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

### Frontend-Probleme

**Port 3000 bereits belegt:**
```bash
# Finde Prozess auf Port 3000
lsof -i :3000
# Prozess beenden oder anderen Port verwenden
PORT=3001 npm run dev
```

**API-Verbindung schlägt fehl:**
```bash
# Prüfe ob Backend läuft
curl http://localhost:8000/

# CORS-Fehler? Prüfe backend/api/main.py
# Stelle sicher dass CORS richtig konfiguriert ist

# .env.local im Frontend prüfen
cat frontend/.env.local
```

**Node Modules Probleme:**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

**TypeScript Fehler:**
```bash
cd frontend
npm run build  # Zeigt alle TS-Fehler
npx tsc --noEmit  # Type-Check ohne Build
```

### Backend-Probleme

**Port bereits belegt:**
```bash
# Finde Prozess auf Port 8000
lsof -i :8000

# Oder ändere Port in compose.yaml
ports:
  - "8080:8000"  # Extern 8080, intern 8000
```

**Redis Verbindung fehlgeschlagen:**
```bash
# Prüfe Redis
docker-compose exec redis redis-cli ping
# Sollte "PONG" zurückgeben

# Logs prüfen
docker-compose logs redis
```

**Data Loader zeigt keine Logs:**
```bash
# Manuell ausführen
docker-compose run --rm data_loader

# Oder im Vordergrund
docker-compose up data_loader
```

**Python Module nicht gefunden:**
```bash
# Container neu bauen
docker-compose build --no-cache api
docker-compose up -d
```

**API lädt Änderungen nicht:**
```bash
# Prüfe ob --reload aktiv ist
docker-compose logs api | grep reload

# Manuell neu starten
docker-compose restart api
```

**Daten importieren dauert zu lange:**
```bash
# API-Limit erreicht? Prüfe Logs
docker-compose logs data_loader | grep Error

# Reduziere Jahre in initial_load.py
# Ändere: for year in ["2024", "2025"]
# Zu: for year in ["2025"]
```

### Podman-spezifische Probleme

**Podman Compose nicht gefunden:**
```bash
# Installiere podman-compose
pip3 install podman-compose

# Oder verwende podman-compose als Plugin
podman compose up -d
```

**Permission-Probleme:**
```bash
# Rootless Mode aktivieren
podman system migrate

# SELinux Labels (Linux only)
# Füge :Z zu Volumes hinzu in compose.yaml
volumes:
  - ./backend:/app:Z
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

**Backend:**
- [ ] ML Model Training & Predictions implementieren (`ML/train.py`, `ML/predict.py`)
- [ ] Weather Fetcher vervollständigen (`data_ingestion/weather_fetcher.py`)
- [ ] Scheduler Jobs aktivieren (stündlich, täglich)
- [ ] API Tests schreiben
- [ ] Performance Optimierung (Caching, Query-Optimierung)

**Frontend:**
- [ ] Predictions-Visualisierung erweitern
- [ ] Interaktive Karten-Integration (Leaflet/Mapbox)
- [ ] Export-Funktionen (CSV, PDF)
- [ ] Responsive Design verbessern
- [ ] Accessibility (a11y) Tests
- [ ] End-to-End Tests (Playwright/Cypress)

**DevOps:**
- [ ] CI/CD Pipeline (GitHub Actions)
- [ ] Docker Compose für Production
- [ ] Monitoring & Logging (Prometheus, Grafana)
- [ ] Deployment-Strategie (Docker Swarm / Kubernetes)
- [ ] Backup-Strategie für Redis
- [ ] SSL/TLS Zertifikate für Production

**Dokumentation:**
- [ ] API Dokumentation erweitern
- [ ] Architektur-Diagramme aktualisieren
- [ ] Entwickler-Onboarding-Guide
- [ ] Deployment-Guide

---

## Contributing

Beiträge sind willkommen! Bitte folge dem [Git Workflow](#git-workflow--kollaboration) Abschnitt.

**Schritte für Contributions:**

1. **Fork** das Repository
2. **Clone** deinen Fork
3. **Branch** erstellen: `git checkout -b feature/deine-feature`
4. **Änderungen** machen und committen
5. **Tests** ausführen (falls vorhanden)
6. **Push** zu deinem Fork: `git push origin feature/deine-feature`
7. **Pull Request** erstellen auf GitHub

**Code Style:**
- Python: PEP 8, Black Formatter
- TypeScript/React: ESLint + Prettier
- Commits: Conventional Commits Format

**Vor dem Pull Request:**
- [ ] Code läuft lokal ohne Fehler
- [ ] ESLint/Type-Checks passieren
- [ ] README bei Bedarf aktualisiert
- [ ] Commit-Messages folgen Convention

---

## Support & Kontakt

Bei Problemen oder Fragen:

**Debugging-Checkliste:**
1. Logs prüfen: `docker-compose logs -f`
2. Redis prüfen: `docker-compose exec redis redis-cli`
3. Container Status: `docker-compose ps`
4. Swagger UI für API-Tests: http://localhost:8000/docs
5. Frontend Console (Browser DevTools) auf Fehler prüfen

**Hilfreiche Links:**
- [Next.js Dokumentation](https://nextjs.org/docs)
- [FastAPI Dokumentation](https://fastapi.tiangolo.com/)
- [Redis Dokumentation](https://redis.io/docs/)
- [TanStack Query Docs](https://tanstack.com/query/latest)
- [shadcn/ui Components](https://ui.shadcn.com/)

---