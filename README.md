# ILG — Israel Lifeguards Surf Forecast

Real-time surf forecasting platform for Israeli Mediterranean beaches.
Built with Next.js 16 (App Router), Firebase Firestore, and multiple marine data APIs.

---

## Data Flow

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                           DATA SOURCES (per request)                         ║
╠══════════════════╦════════════════════╦════════════════╦═════════════════════╣
║  Open-Meteo      ║  StormGlass        ║  WorldTides    ║  ISRAMAR Hadera     ║
║  Marine + Weather║  (10 req/day)      ║  (extremes     ║  Buoy               ║
║  no-store cache  ║  3h cache          ║   only, 12h    ║  1h cache           ║
║  swell + wind    ║  swell + current   ║   cache)       ║  live Hs + T + Dir  ║
╚════════╤═════════╩═════════╤══════════╩═══════╤════════╩══════════╤══════════╝
         │                   │                  │                   │
         ▼                   ▼                  ▼                   ▼
╔═══════════════════════════════════════════════════════════════════════════════╗
║                   surf.ts — fetchSurfForecast(lat, lng, beachId)             ║
║                                                                               ║
║  STEP 1 — Parallel fetch (Promise.all)                                        ║
║    Firestore: tide_offset  +  beach_calibration  +  WorldTides API            ║
║                                                                               ║
║  STEP 2 — Buoy validation + EMA smoothing                                     ║
║    validateIsramarBuoy(): reject if Hs > 10m | T ∉ [2,25]s | age > 3h        ║
║    getSmoothedBuoyHeight(): EMA α=0.35 persisted in system/buoy_wave_ema      ║
║    Rate-limited: 1 Firestore write/hr                                         ║
║    buoyLive = true → confidenceScore +35                                      ║
║                                                                               ║
║  STEP 3 — Sector-based rolling bias (Firestore: system/buoy_bias_v2)          ║
║    8 compass sectors × independent EMA (α=0.15)                               ║
║    Blended: stored_bias×0.7 + live_error×0.3  clamped to [−0.8, +0.8] m      ║
║                                                                               ║
║  STEP 4 — Effective wave height                                               ║
║    safeCalcWaveHeight():                                                      ║
║      calm sea (Hs < 2m): spectral → √((swell×1.2)² + (windWave×0.6)²) / 2   ║
║      rough sea (Hs ≥ 2m): 80% buoyFaceH + 20% spectral                       ║
║    Guard clauses: non-finite inputs clamped to 0, returns null on exception   ║
║                                                                               ║
║  STEP 5 — Tides                                                               ║
║    WorldTides API (12h cache) ──→ cosine interpolation between extremes       ║
║    Fallback: 8-constituent harmonic model (M2 S2 N2 K2 K1 O1 P1 Q1)          ║
║    Per-beach offset applied from Firestore beaches/{id}/tide_settings         ║
║    WorldTides used → confidenceScore +25                                      ║
║                                                                               ║
║  STEP 6 — Calibration (Firestore: beach_calibration/{beachId})                ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │  raw_Hs   × height_factor      → cal_Hs          [0.4 – 2.5]          │  ║
║  │  raw_T    × period_factor      → cal_T           [0.5 – 2.0]          │  ║
║  │  wind_kn  + wind_bias_knots    → cal_wind        [±8 kn]              │  ║
║  │  285°     + swell_angle_offset → effective_dir   [±45°]               │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║    EMA learning: submitBeachObservation() α=0.25 on height_factor             ║
║    Garbage guard: |observed−model|/model > 50% → rejected (HTTP 400)          ║
║    Audit trail: every change → calibration_logs/{auto_id}                     ║
║    Calibrated beach → confidenceScore +10                                     ║
║                                                                               ║
║  STEP 7 — Derived values                                                      ║
║    safeCalcWaveEnergy(): P = 0.4903 × Hs² × T  [kW/m]                       ║
║    calcRating():  score 1–10  (height + period + wind + coast direction)      ║
║    coastlineCorrection(): cos(|waveDeg − (285° + offset)|), 0 if diff ≥ 90°  ║
║                                                                               ║
║  STEP 8 — Confidence score (see section below)                                ║
║    confidenceScore = 30 + buoyBonus + tidesBonus + calibrationBonus           ║
╚═══════════════════════════════════════════════════════════════════════════════╝
         │
         ▼
╔═══════════════════════════════════════════════════════════════════════════════╗
║                  SurfForecastData (returned to UI client)                     ║
║                                                                               ║
║  current:         SurfCurrent  { waveHeight, wavePeriod, windSpeed,           ║
║                                  waveEnergy, rating, buoy fields... }         ║
║  todayHours:      SurfHour[]   (06:00–21:00, every 3h)                       ║
║  days:            SurfDay[]    (7-day, with per-day SurfHour[] + tides)       ║
║  tides:           TidePoint[]  (15-min resolution, today only)                ║
║  tideExtremes:    TideExtreme[] (High/Low with timestamps, today only)        ║
║  buoyLive:        boolean      (false → UI shows "⚠️ מודל בלבד")             ║
║  calibration:     BeachCalibration (active factors for admin submission)      ║
║  confidenceScore: number       (0–100, see below)                            ║
║  sources:         string[]     (which APIs contributed)                       ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## Confidence Score

`SurfForecastData.confidenceScore` is a 0–100 integer that captures the overall **data quality** of a forecast at the moment it was generated. Use it to:
- Show a quality indicator badge in the UI (e.g. green/yellow/red)
- Set alerting thresholds in Vercel Log Drain (alert if score < 40)
- Let operators know when a beach needs manual observation submission

### Composition

| Component         | Points | Condition                                              |
|-------------------|--------|--------------------------------------------------------|
| Baseline          | **30** | Always. Open-Meteo Marine + ECMWF wind always present. |
| `buoyLive`        | **+35**| ISRAMAR buoy passed validation and Hs was EMA-blended. |
| `usingWorldTides` | **+25**| WorldTides API returned valid extremes for today.      |
| Calibrated beach  | **+10**| Any `beach_calibration` factor differs from default.   |
| **Total**         | **100**| All sources live + beach calibrated.                   |

### Interpretation

| Score | Meaning                                                                  |
|-------|--------------------------------------------------------------------------|
| 100   | Full data: buoy live + WorldTides + calibrated. Maximum confidence.      |
| 65    | Buoy live + WorldTides. Model-only for a beach with no calibration yet.  |
| 55    | Buoy live + harmonic tides. WorldTides key missing or quota exceeded.    |
| 40    | WorldTides + calibrated, but buoy unavailable. Pure model for waves.     |
| 30    | Minimum viable: Open-Meteo only. Buoy offline, WorldTides unavailable.   |

> A score of 30 is normal at night (buoy may be stale) or when WorldTides free quota is exhausted. Consider adding a manual observation via `/api/admin/beach-observation` to boost the height_factor when only model data is available.

---

## Wave Energy Formula

Wave power (energy flux) per unit crest width:

```
P = (ρ · g²) / (64π) · Hs² · T
  ≈ 0.4903 · Hs² · T   [kW/m]
```

Where:
- `ρ` = 1025 kg/m³ (seawater density)
- `g` = 9.81 m/s²
- `Hs` = significant wave height in metres (after calibration)
- `T` = peak period in seconds (after calibration)

**Rule of thumb:** P > 5 kW/m = energetic surf, shown in bold in the Admin Panel.

| Hs (m) | T (s) | P (kW/m) | Description     |
|--------|-------|----------|-----------------|
| 0.5    | 6     | 0.74     | Flat            |
| 1.0    | 8     | 3.92     | Small           |
| 1.5    | 10    | 11.03    | Fun             |
| 2.0    | 12    | 23.53    | Solid           |
| 3.0    | 14    | 61.76    | Large / Hazard  |

---

## Beach Calibration — Quick Start for New Developers

The calibration system corrects per-beach forecast errors using four independent factors stored in Firestore (`beach_calibration/{beachId}`).

### Accessing the Admin Panel

Navigate to `/admin` and enter the admin password (set in `ADMIN_PASSWORD` constant or via env).

### Calibration Factors

| Column   | Field                | Range       | Effect                                                   |
|----------|----------------------|-------------|----------------------------------------------------------|
| Hs ×     | `height_factor`      | [0.4 – 2.5] | Multiplies displayed wave height. `1.25` = +25%.        |
| T ×      | `period_factor`      | [0.5 – 2.0] | Multiplies displayed wave period. `1.0` = no change.    |
| Wind kn  | `wind_bias_knots`    | [−8 – 8]    | Additive offset to displayed wind speed in knots.       |
| Angle °  | `swell_angle_offset` | [−45 – 45]  | Shifts effective coastline direction (base = 285°).     |

### Method 1 — Admin Panel (manual override)

1. Go to `/admin` → **כיול חופים** section.
2. Edit the value in the relevant column for the beach.
3. Row highlights yellow — click **שמור** to persist.
4. The change takes effect on the next forecast fetch (Firestore is read live, no cache).

### Method 2 — Real-World Observation (EMA learning)

Submit what you actually see on the water vs. what the model predicted:

```
GET /api/admin/beach-observation?beach=tlv&observed=1.5&model=1.2
```

- `beach` — beach ID (see list below)
- `observed` — face height you measured on the water (metres)
- `model` — raw pre-calibration model output from `/api/admin/debug-surf?beach=tlv` → `waves.effectiveWaveHeightResult`

The EMA update formula:
```
new_factor = old_factor × (1 − 0.25) + (observed / model) × 0.25
```
After ~8 consistent observations, the factor fully converges.

**Rejection rule:** observations that deviate more than 50% from the model are rejected with HTTP 400 (garbage-report guard).

### Method 3 — Debug First

Before calibrating, run the debug endpoint to understand current pipeline state:

```
GET /api/admin/debug-surf?beach=tlv
```

Key fields in the response:
- `waves.buoyRawHs` — raw buoy reading
- `waves.buoySmoothedHs` — EMA-smoothed buoy
- `waves.effectiveWaveHeightResult` — value **before** calibration (use this as `model=` param)
- `waves.finalDisplayedHs` — value **after** calibration (what the user sees)
- `calibration` — current factors for this beach

### Beach IDs

| ID         | Name                  |
|------------|-----------------------|
| `nahariya` | נהריה                 |
| `acre`     | עכו                   |
| `haifa`    | חיפה – חוף הכרמל     |
| `netanya`  | נתניה                 |
| `herzliya` | הרצליה                |
| `tlv`      | תל אביב – הילטון     |
| `ashdod`   | אשדוד                 |
| `ashkelon` | אשקלון                |
| `eilat`    | אילת – ים סוף         |

---

## Environment Variables

### Required (build will fail without these)

| Variable                          | Description                                              |
|-----------------------------------|----------------------------------------------------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY`    | Firebase Web API key                                     |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`| Firebase Auth domain (`project.firebaseapp.com`)         |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID                                      |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket                              |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID                  |
| `NEXT_PUBLIC_FIREBASE_APP_ID`     | Firebase App ID                                          |
| `STORMGLASS_API_KEY`              | StormGlass Marine API key (10 req/day on free tier)      |
| `CRON_SECRET`                     | Secret for authenticating Vercel Cron Job requests       |

### Optional

| Variable               | Description                                                    |
|------------------------|----------------------------------------------------------------|
| `WORLDTIDES_API_KEY`   | WorldTides v3 API key (tides). Falls back to harmonic model.   |
| `RESEND_API_KEY`       | Resend email API key (user notifications).                     |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name (image upload).               |
| `CLOUDINARY_API_SECRET`| Cloudinary API secret (server-side upload signing).            |

### Local setup

```bash
cp .env.example .env.local
# Fill in required values, then:
npm run dev
```

The pre-build script (`scripts/check-env.mjs`) verifies all required variables are set and not placeholder values. It runs automatically before `npm run build`.

---

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── admin/
│   │   │   ├── beach-observation/   # POST real-world observation → EMA update
│   │   │   ├── calibrate-tide/      # Set per-beach tide offset
│   │   │   ├── debug-surf/          # Full pipeline debug report
│   │   │   └── revalidate-beach/    # Purge Next.js Data Cache for a beach
│   │   └── cron/
│   │       └── tide-health/         # Daily cron: check WorldTides API health
│   ├── admin/                       # Admin Panel (password-gated)
│   └── dashboard/                   # Main user-facing surf dashboard
├── components/
│   ├── admin/
│   │   ├── BeachCalibrationPanel    # SWR-powered calibration table
│   │   └── UserQueue                # Pending user approval queue
│   └── dashboard/
│       └── SurfForecast             # Main forecast display component
└── lib/
    ├── api/
    │   ├── surf.ts                  # Core forecast pipeline
    │   ├── beachCalibration.ts      # Calibration CRUD + EMA + audit trail
    │   ├── beachMetadata.ts         # LRU-cached beach config from Firestore
    │   ├── buoyBias.ts              # Sector-based rolling EMA bias correction
    │   └── weather.ts               # Open-Meteo weather fetch
    ├── beaches.ts                   # Static beach list (baseline for metadata)
    └── firebase/
        ├── config.ts                # Firebase app initialization
        └── firestore.ts             # User / Job / Course CRUD
```

## Firestore Collections

| Collection           | Purpose                                                        |
|----------------------|----------------------------------------------------------------|
| `users`              | Registered users (role, verification status)                   |
| `jobs`               | Lifeguard job postings                                         |
| `courses`            | Training courses                                               |
| `config/global_alert`| Site-wide alert banner                                         |
| `beach_calibration`  | Per-beach calibration factors (height, period, wind, angle)    |
| `beach_metadata`     | Per-beach extended config (avgDepth, name/coord overrides)     |
| `calibration_logs`   | Audit trail for all calibration changes                        |
| `system/buoy_wave_ema` | EMA state for ISRAMAR buoy smoothing                        |
| `system/buoy_bias_v2`| Sector-based rolling bias EMA state                            |
| `system/tide_health` | Last successful WorldTides API call timestamp                  |

---

## Deployment (Vercel)

```bash
vercel deploy --prod
```

Vercel Cron Job runs daily at 04:00 UTC to check WorldTides API health.
See `vercel.json` for cron schedule and response header configuration.
