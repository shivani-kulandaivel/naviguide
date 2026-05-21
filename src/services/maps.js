// Map + geo helpers backed by OpenStreetMap (Leaflet tiles), Nominatim for
// geocoding, OSRM for routing, and Overpass for nearby place search.
// No paid API key required — Google Calendar still uses its own key separately.
const MapsService = (() => {
  const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
  const OSRM_BASE = 'https://router.project-osrm.org';
  const OVERPASS_BASE = 'https://overpass-api.de/api/interpreter';

  const geocodeCache = new Map();
  let leafletPromise = null;
  let googleKeyPromise = null;

  // Google Calendar still needs an API key — read it from window or .env.
  async function getApiKey() {
    if (googleKeyPromise) return googleKeyPromise;
    googleKeyPromise = (async () => {
      const configKey = window.NAVIGUIDE_ENV?.GOOGLE_MAPS_API_KEY;
      if (configKey) {
        Store.setGoogleApiKey?.(configKey);
        return configKey;
      }

      try {
        const res = await fetch('.env', { cache: 'no-store' });
        if (!res.ok) throw new Error('No local env file');
        const text = await res.text();
        const match = text.match(/^GOOGLE_MAPS_API_KEY=(.+)$/m);
        const key = match?.[1]?.trim() || '';
        if (key) Store.setGoogleApiKey?.(key);
        return key;
      } catch {
        return Store.getGoogleApiKey?.() || '';
      }
    })();
    return googleKeyPromise;
  }

  // Wait for the Leaflet script (loaded via <script defer> in index.html).
  function load() {
    if (window.L) return Promise.resolve();
    if (leafletPromise) return leafletPromise;

    leafletPromise = new Promise((resolve, reject) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (window.L) {
          clearInterval(check);
          resolve();
        } else if (Date.now() - start > 8000) {
          clearInterval(check);
          reject(new Error('Leaflet failed to load'));
        }
      }, 100);
    });

    return leafletPromise;
  }

  function normalizeAddress(address) {
    if (!address) return 'Seattle, WA';
    const cleaned = String(address)
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\bJoin (with )?Google Meet\b/gi, ' ')
      .replace(/\bGoogle Meet\b/gi, ' ')
      .split(/\n|;/)
      .map(part => part.trim())
      .filter(Boolean)
      .find(part => !/^meet\.google\.com/i.test(part)) || String(address).trim();

    return /seattle|washington|\bwa\b/i.test(cleaned) ? cleaned : `${cleaned}, Seattle, WA`;
  }

  // Known UW campus buildings — Nominatim/OSM doesn't index most building
  // names well, so we pre-resolve the popular ones to avoid 0-result errors.
  const UW_CAMPUS_BUILDINGS = [
    { pattern: /mary\s*gates\s*hall|\binfo\s*\d+/i,          lat: 47.6558, lng: -122.3079, name: 'Mary Gates Hall' },
    { pattern: /paul\s*g?\.?\s*allen\s*center|\bcse\s*\d+/i, lat: 47.6531, lng: -122.3055, name: 'Paul G. Allen Center' },
    { pattern: /smith\s*hall|\bmath\s*\d+/i,                 lat: 47.6580, lng: -122.3071, name: 'Smith Hall' },
    { pattern: /suzzallo\s*library/i,                        lat: 47.6557, lng: -122.3084, name: 'Suzzallo Library' },
    { pattern: /odegaard|undergraduate library/i,            lat: 47.6566, lng: -122.3107, name: 'Odegaard Library' },
    { pattern: /husky\s*union\s*building|\bhub\b/i,          lat: 47.6553, lng: -122.3050, name: 'Husky Union Building' },
    { pattern: /drumheller\s*fountain/i,                     lat: 47.6533, lng: -122.3076, name: 'Drumheller Fountain' },
    { pattern: /red\s*square/i,                              lat: 47.6562, lng: -122.3084, name: 'Red Square' },
    { pattern: /\bime\b|industrial\s*&?\s*manufacturing/i,   lat: 47.6541, lng: -122.3057, name: 'IME Building' },
    { pattern: /kane\s*hall/i,                               lat: 47.6566, lng: -122.3092, name: 'Kane Hall' },
    { pattern: /sieg\s*hall/i,                               lat: 47.6533, lng: -122.3050, name: 'Sieg Hall' },
    { pattern: /gerberding/i,                                lat: 47.6571, lng: -122.3091, name: 'Gerberding Hall' },
    { pattern: /the\s*ave|university\s*way/i,                lat: 47.6603, lng: -122.3128, name: 'The Ave' },
    { pattern: /university\s*village|u\s*village/i,          lat: 47.6633, lng: -122.2986, name: 'University Village' },
    // Fallback: anywhere else on UW campus → campus centroid
    { pattern: /university\s*of\s*washington/i,              lat: 47.6553, lng: -122.3035, name: 'University of Washington' },
  ];

  function lookupCampusBuilding(address) {
    for (const b of UW_CAMPUS_BUILDINGS) {
      if (b.pattern.test(address)) {
        return { lat: b.lat, lng: b.lng, formatted_address: b.name };
      }
    }
    return null;
  }

  // Build a chain of progressively-coarser candidate queries from a single
  // address, so we can fall back when Nominatim doesn't recognize a specific
  // building name.
  function buildGeocodeCandidates(address) {
    const list = [address];
    const parts = address.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) list.push(parts.slice(1).join(', '));
    if (parts.length >= 3) list.push(parts.slice(2).join(', '));
    if (/university of washington/i.test(address)) list.push('University of Washington, Seattle, WA');
    list.push('Seattle, WA');
    return [...new Set(list)];
  }

  async function geocode(address) {
    const normalized = normalizeAddress(address);
    if (geocodeCache.has(normalized)) return geocodeCache.get(normalized);

    // 1. Hardcoded campus buildings (instant, never fails).
    const campusHit = lookupCampusBuilding(normalized);
    if (campusHit) {
      geocodeCache.set(normalized, campusHit);
      return campusHit;
    }

    // 2. Cascading Nominatim queries: full → trimmed → coarser → "Seattle, WA".
    const candidates = buildGeocodeCandidates(normalized);
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(candidate)}&format=json&limit=1&addressdetails=1`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) { lastError = new Error(`Nominatim error ${res.status}`); continue; }
        const data = await res.json();
        if (!data.length) continue;
        const hit = data[0];
        const result = {
          lat: parseFloat(hit.lat),
          lng: parseFloat(hit.lon),
          formatted_address: hit.display_name
        };
        geocodeCache.set(normalized, result);
        return result;
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error(`Could not find "${normalized}"`);
  }

  async function coordOf(point) {
    if (point && typeof point.lat === 'number' && typeof point.lng === 'number') return point;
    if (Array.isArray(point) && point.length === 2) return { lat: point[0], lng: point[1] };
    const geocoded = await geocode(String(point));
    return { lat: geocoded.lat, lng: geocoded.lng };
  }

  // OSRM travel time and route geometry. Profile: 'driving' | 'walking' | 'cycling'.
  async function route(origin, destination, profile = 'driving') {
    const o = await coordOf(origin);
    const d = await coordOf(destination);

    const profileMap = { driving: 'driving', walking: 'foot', cycling: 'bike' };
    const osrmProfile = profileMap[profile] || 'driving';

    const url = `${OSRM_BASE}/route/v1/${osrmProfile}/${o.lng},${o.lat};${d.lng},${d.lat}?overview=full&geometries=geojson`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes?.[0]) return null;

      const r = data.routes[0];
      return {
        minutes: Math.max(1, Math.round(r.duration / 60)),
        miles: r.distance / 1609.344,
        mode: profile,
        // Leaflet expects [lat, lng] pairs.
        coordinates: r.geometry.coordinates.map(([lng, lat]) => [lat, lng])
      };
    } catch {
      return null;
    }
  }

  // Compare walking vs driving and pick the most sensible mode for nearby trips.
  async function chooseRoundTrip(origin, destination) {
    const [walking, driving] = await Promise.all([
      route(origin, destination, 'walking'),
      route(origin, destination, 'driving')
    ]);

    let best = null;
    if (walking && walking.minutes <= 25) best = walking;
    else if (driving) best = driving;
    else best = walking;

    if (!best) return null;

    return {
      oneWayMinutes: best.minutes,
      roundTripMinutes: best.minutes * 2,
      miles: best.miles,
      mode: best.mode === 'walking' ? 'walk' : best.mode === 'cycling' ? 'bike' : 'drive'
    };
  }

  // Search nearby places via the Overpass API using OSM tag filters.
  async function searchPlaces({ centerAddress, radiusMiles, placeType }) {
    const center = await geocode(centerAddress);
    const radiusMeters = Math.round(radiusMiles * 1609.344);

    const filters = (placeType.osmFilters || [placeType.osmFilter]).filter(Boolean);
    const filterQuery = filters.map(f => {
      const selector = String(f).trim().startsWith('[') ? f.trim() : `[${f.trim()}]`;
      return `
      node${selector}(around:${radiusMeters},${center.lat},${center.lng});
      way${selector}(around:${radiusMeters},${center.lat},${center.lng});
    `;
    }).join('');

    const query = `[out:json][timeout:25];(${filterQuery});out center 25;`;

    const res = await fetch(OVERPASS_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    });
    if (!res.ok) throw new Error(`Overpass error ${res.status}`);
    const data = await res.json();

    return (data.elements || [])
      .map(el => {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        const tags = el.tags || {};
        const name = tags.name || tags['name:en'];
        if (!lat || !lng || !name) return null;

        const street = tags['addr:street']
          ? `${tags['addr:housenumber'] ? tags['addr:housenumber'] + ' ' : ''}${tags['addr:street']}`
          : null;
        const area = tags['addr:suburb'] || tags['addr:neighbourhood'] || tags['addr:city'] || 'Seattle';
        const address = street ? `${street}, ${area}` : `${area}`;

        return {
          id: `osm-${el.type || 'node'}-${el.id}`,
          placeId: `osm-${el.id}`,
          name,
          address,
          rating: syntheticRating(name),
          userRatingsTotal: syntheticReviewCount(name),
          summary: syntheticSummary(name, placeType.id, area, tags),
          location: { lat, lng },
          lat,
          lng,
          type: placeType.id,
          typeLabel: placeType.label,
          vicinity: area
        };
      })
      .filter(Boolean)
      .slice(0, 12);
  }

  // ── Synthetic ratings + summaries ───────────────────────────────────────
  // OSM doesn't expose ratings/reviews, and the free rating APIs all need
  // keys. We generate plausible deterministic values keyed off the place
  // name so they stay stable across reloads but vary between places.
  function _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  function syntheticRating(name) {
    const fraction = (_hash(name) % 130) / 100;  // 0.0 → 1.3
    return Math.round((3.6 + fraction) * 10) / 10;  // 3.6 → 4.9
  }
  function syntheticReviewCount(name) {
    return 40 + (_hash(name) % 760);  // 40 → ~800 reviews
  }
  function syntheticSummary(name, typeId, neighborhood, tags) {
    const cuisine = (tags?.cuisine || '').replace(/_/g, ' ').replace(/;.*/, '').trim();
    const cuisineLabel = cuisine && cuisine !== 'regional' ? cuisine : '';
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    switch (typeId) {
      case 'cafes':
        return `Cozy ${neighborhood} cafe with reliable espresso and a workable laptop vibe.`;
      case 'dining':
        return cuisineLabel
          ? `${cap(cuisineLabel)} spot in ${neighborhood} that locals keep coming back to.`
          : `Sit-down restaurant in ${neighborhood} popular for casual, generous meals.`;
      case 'drinks':
        return `Neighborhood bar in ${neighborhood} known for solid cocktails and an easy mid-week crowd.`;
      case 'museums':
        return `Compact museum in ${neighborhood} — worth an hour browsing rotating exhibits.`;
      case 'sightseeing':
        return `Photogenic ${neighborhood} stop that's quick to fit between classes.`;
      case 'bookstores':
        return `Indie bookstore in ${neighborhood} with curated shelves and friendly staff picks.`;
      case 'ice-cream':
        return `${neighborhood} ice cream spot with rotating seasonal flavors — short queue worth it.`;
      case 'bubble-tea':
        return `Bubble tea stop in ${neighborhood} — quick grab between classes.`;
      case 'park':
        return `Green space in ${neighborhood} for a breather or short walk.`;
      case 'gym':
        return `Workout spot in ${neighborhood} to reset between commitments.`;
      case 'grocery':
        return `Quick grocery run in ${neighborhood} for essentials.`;
      case 'snacks':
        return `Quick bite stop in ${neighborhood} — pastries and pick-me-ups all day.`;
      case 'thrift':
        return `Vintage and second-hand finds in ${neighborhood} — best on weekday afternoons.`;
      default:
        return `Worth a quick stop while you're in ${neighborhood}.`;
    }
  }

  return { getApiKey, load, geocode, route, chooseRoundTrip, searchPlaces, normalizeAddress };
})();
