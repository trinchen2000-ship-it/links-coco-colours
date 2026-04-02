# links.coco-colours.de

Landing Page + Analytics — alles in einem Railway-Projekt.

## Struktur
```
server.js          → Express: Landing Page + /track + /dashboard
public/index.html  → Die Landing Page (mit Tracker)
package.json
```

## Railway Deployment

### 1. GitHub Repo
- Neues Repo: `links-coco-colours`
- Alle Dateien hochladen (inkl. public/index.html)

### 2. Railway Projekt
- railway.app → New Project → Deploy from GitHub → `links-coco-colours`

### 3. PostgreSQL hinzufügen
- Im Railway Projekt: + Add → Database → PostgreSQL
- `DATABASE_URL` wird automatisch gesetzt

### 4. Environment Variables
```
DASHBOARD_TOKEN = dein-geheimes-passwort
NODE_ENV        = production
```

### 5. Custom Domain
- Railway → Settings → Domains → `links.coco-colours.de`
- Bei IONOS: CNAME → `dein-projekt.up.railway.app`

## URLs
| Was | URL |
|-----|-----|
| Landing Page | https://links.coco-colours.de |
| Dashboard | https://links.coco-colours.de/dashboard?token=DEIN_TOKEN |
| Track Endpoint | POST https://links.coco-colours.de/track |

## Dashboard zeigt
- Seitenaufrufe mit Stadt, Gerät, Browser
- Woher Besucher kommen (Städte-Ranking)
- Was angeklickt wurde (Links, Social, Tools)
- Tattoo-Berater: Traditionen, Bedeutungen
- Symbol-Suchen
- Größen-Rechner Nutzung
- Slot Machine Spins
- 30-Tage-Verlauf
- Aktive Sessions
- Live Feed aller Events
