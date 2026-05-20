# NaviGuide — UW campus day planner

A local web app for UW students: campus calendar events, Google Calendar sync, Gemini-powered **Add to my day**, and Discover spots on campus.

## Setup (2 minutes)
## made changes
## Celine

#yayay
### Option A — VS Code Live Server (recommended)
1. Open this folder in VS Code
2. Install the **Live Server** extension (by Ritwick Dey)
3. Right-click `index.html` → **Open with Live Server**
4. The app opens at `http://127.0.0.1:5500`

### Option B — Python (no extensions needed)
```bash
cd wayfarer
python3 -m http.server 3000
```
Then open `http://localhost:3000`

### Option C — Node
```bash
npx serve .
```

---

## Add your Gemini API key (for AI features)

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and create an API key
2. Click the status indicator in the bottom-left of the app
3. Paste your key and click Save

Your key is stored in your browser's localStorage — never sent anywhere except Google's Gemini API.

---

## What the app does

| Tab | Description |
|-----|-------------|
| **Today** | UW calendar with filters (Campus, Dawg Daze), campus event refresh, **Add to my day** (NL → calendar), route map |
| **Log Trip** | Manually log trips. AI can suggest what to log. |
| **Discover** | UW campus places that fit gaps in your schedule |

### UW campus events

- **Refresh campus events** pulls from `api/uw-events` (Trumba RSS) when deployed on Vercel/Netlify.
- Local demo uses `src/data/uw-events-seed.json` if the API is unavailable.
- Deploy: `vercel` or `netlify deploy` so `/api/uw-events` is reachable.

### Add to my day (AI)

Type natural language on the Today tab (e.g. “Coffee with Alex at 3pm at the HUB”). Gemini returns a preview; tap **Add to calendar** to merge into your day (and Google Calendar if connected).

---

## Connecting real data (next steps)

### Google Calendar
Replace the seed events in `src/data/store.js` with a real Google Calendar API call:
```
GET https://www.googleapis.com/calendar/v3/calendars/primary/events
Authorization: Bearer YOUR_OAUTH_TOKEN
```

### Mapping stack (no API key needed)
- **Map tiles:** [CARTO Light](https://carto.com/attribution) via Leaflet
- **Geocoding:** [Nominatim](https://nominatim.org/) — `https://nominatim.openstreetmap.org/search`
- **Routing / travel time:** [OSRM public demo](https://project-osrm.org/) — `https://router.project-osrm.org/route/v1`
- **Nearby places (Discover):** [Overpass API](https://overpass-api.de/) — `https://overpass-api.de/api/interpreter`

All free and CORS-friendly. Please respect their usage policies (no high-volume traffic).

### Location auto-detection
Use the browser Geolocation API to log trips automatically:
```javascript
navigator.geolocation.watchPosition(pos => {
  // log position changes, detect when you've arrived somewhere
});
```

---

## File structure

```
wayfarer/
├── index.html              # Entry point
├── src/
│   ├── app.js              # Nav, Gemini API calls, key management
│   ├── data/
│   │   └── store.js        # Trip data, stats, seed calendar events
│   ├── components/
│   │   ├── today.js        # Today tab
│   │   ├── log.js          # Log trip tab
│   │   ├── habits.js       # Habits tab
│   │   └── discover.js     # Discover tab
│   └── styles/
│       └── main.css        # All styles
└── README.md
```
