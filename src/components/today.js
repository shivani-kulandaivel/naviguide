// Today tab rendering helpers.
// Creates grouped calendar event cards and renders the Today view with stats.
// Format a calendar date label for the Today view.
function formatCalDate(date) {
  return date ? new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date';
}

// Group calendar events by date label for display in the Today tab.
function renderCalendarGroups(events) {
  const grouped = events.reduce((acc, e) => {
    const label = formatCalDate(e.date);
    if (!acc[label]) acc[label] = [];
    acc[label].push(e);
    return acc;
  }, {});

  return Object.entries(grouped).map(([label, dayEvents]) => `
    <div class="cal-day-group">
      <div class="cal-day-divider">${label}</div>
      ${dayEvents.map(e => `
        <div class="cal-row">
          <div class="cal-time">${e.time}</div>
          <div class="cal-body">
            <div class="cal-title">${e.title}</div>
            ${getEventLocation(e) ? `<div class="cal-loc">${getEventLocation(e)}</div>` : '<div class="cal-loc" style="color:var(--text3)">Remote</div>'}
            ${e.depart ? `<div class="cal-pill">Leave by ${e.depart} · ~${e.eta}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// Render the Today tab content, including calendar cards and AI prompts.
function renderToday() {
  const pane = document.getElementById('tab-today');
  const stats = Store.getStats();
  const events = Store.calendarEvents;

  // Convert a time string to minutes since midnight so events can be sorted.
  function timeToMinutes(timeStr) {
    if (!timeStr) return 9999;
    const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return timeStr === 'All Day' ? 0 : 9999;
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ampm = (m[3] || '').toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + mm;
  }

  // Normalize a datetime string to YYYY-MM-DD for date-based sorting.
  // Split on 'T' directly instead of toISOString() to avoid UTC date shifting.
  function normalizeDateIso(d) {
    if (!d) return '';
    try { return d.split('T')[0].slice(0, 10); } catch { return ''; }
  }

  const sortedEvents = events.slice().sort((a, b) => {
    const da = normalizeDateIso(a.date || a.start || '');
    const db = normalizeDateIso(b.date || b.start || '');
    if (da !== db) return da.localeCompare(db);
    return timeToMinutes(a.time) - timeToMinutes(b.time);
  });

  pane.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Today</div>
        <div class="page-sub">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</div>
      </div>
    </div>

    <div style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <button id="google-calendar-connect-btn" class="btn-primary" onclick="loadGoogleCalendar()">
        Connect Google Calendar
      </button>
      <span id="google-calendar-activity" style="font-size:14px;color:var(--text2);">
        Google Calendar not connected
      </span>
    </div>

    <div class="suggest" id="today-suggest">
      <div class="suggest-label">AI route suggestion</div>
      <div class="suggest-title">Optimized day ahead</div>
      <div class="suggest-body">You have lunch in Capitol Hill at 12pm and gym at 6pm. Leave by 11:42 AM — and consider swapping your usual coffee stop to Broadcast on the return trip to save 9 min total.</div>
      <div class="chips">
        <button class="chip chip-accent" onclick="this.closest('.suggest').style.display='none'">Sounds good</button>
        <button class="chip" onclick="askAI('suggest-ai-out', 'Give me 2 alternative route options for today that avoid highway traffic')">More options</button>
      </div>
      <div class="ai-response" id="suggest-ai-out"></div>
    </div>

      <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-val">${sortedEvents.filter(e=>getEventLocation(e)).length}</div>
        <div class="stat-lbl">trips today</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${sortedEvents.filter(e=>getEventLocation(e)).reduce((a,e)=>a+parseInt(e.eta||0),0)} min</div>
        <div class="stat-lbl">travel time</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${stats.avgDur} min</div>
        <div class="stat-lbl">your avg commute</div>
      </div>
    </div>

      <div class="card">
      <div class="card-label">Calendar</div>
      ${renderCalendarGroups(sortedEvents)}
    </div>

    <div class="card">
      <div class="map-card-head">
        <div>
          <div class="card-label">Route map</div>
          <div class="map-title">Today path + nearby ideas</div>
        </div>
        <div class="map-legend" id="map-legend">
          <span><i class="legend-dot visited"></i> visited</span>
          <span class="legend-empty">loading recs…</span>
          <button class="map-rec-refresh" onclick="refreshMapRecommendations(event)" id="map-rec-refresh">Refresh recs</button>
        </div>
      </div>
      <div id="map" class="map-box"></div>
      <div class="map-hint">
        Scroll to zoom · double-click to zoom in · shift-drag to box-zoom · drag to pan · use the <strong>+ / −</strong> buttons in the corner.
        Red dots are recommended spots near your day — fine-tune them in <strong>Discover</strong>.
      </div>
    </div>

    <div class="card">
      <div class="card-label">Ask AI about today</div>
      <div class="form-grid" style="grid-template-columns:1fr auto">
        <input type="text" id="today-q" placeholder="e.g. What's the best time to leave for my 3pm?" />
        <button class="btn-primary" onclick="askAIFromInput('today-q','today-ai-out')">Ask</button>
      </div>
      <div class="ai-response" id="today-ai-out"></div>
    </div>
  `;
  if (window.updateGoogleCalendarStatus) updateGoogleCalendarStatus();

  // Build the route map after the DOM is ready.
  const todayStr = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
  })();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayLocatedEvents = sortedEvents.filter(e => {
    if (!getEventLocation(e)) return false;
    const eventDate = e.date ? e.date.split('T')[0] : todayStr;
    return eventDate === todayStr;
  });
  const elapsedEvents = todayLocatedEvents.filter(e => timeToMinutes(e.time) <= nowMinutes);
  const mapEvents = elapsedEvents.length ? elapsedEvents : todayLocatedEvents;
  initRouteMap(mapEvents);
}

// ── Route map ─────────────────────────────────────────────────────────────────
async function initRouteMap(events) {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  const recommended = Store.getRecommendedPlaces?.() || [];
  if (!events.length && !recommended.length) {
    renderMapEmpty(mapEl, 'No calendar locations or recommendations yet');
    return;
  }

  try {
    await MapsService.load();
  } catch (err) {
    renderMapEmpty(mapEl, `Map could not load: ${err.message}`);
    return;
  }

  const failedLocations = [];
  const visited = (await Promise.all(events.map(async (event, index) => {
    const location = getEventLocation(event);
    try {
      if (!location) return null;
      const geocoded = await MapsService.geocode(location);
      return {
        event,
        index,
        position: [geocoded.lat, geocoded.lng],
        label: summarizePlace(event.title || location),
        minutes: estimateEventDuration(events, index)
      };
    } catch (err) {
      failedLocations.push(`${location || event.title}: ${err.message}`);
      return null;
    }
  }))).filter(Boolean);

  // Auto-seed nearby spots when there are none yet, OR when the stored set
  // is stale and only has one category (e.g. left over from an older version
  // that only loaded cafes). Either way the user gets variety automatically.
  const uniqueTypes = new Set(recommended.map(r => r?.type).filter(Boolean)).size;
  if (!recommended.length || (recommended.length > 0 && uniqueTypes < 2)) {
    try {
      const anchor = getEventLocation(events.find(getEventLocation)) || 'Seattle, WA';
      const fresh = await loadDefaultRecommendations(anchor);
      if (fresh.length) {
        recommended.length = 0;
        recommended.push(...fresh);
      }
    } catch (err) {
      console.warn('Could not auto-load recommendations:', err);
    }
  }

  const recs = (await Promise.all(recommended.slice(0, 12).map(async place => {
    try {
      let lat = typeof place.lat === 'number' ? place.lat : null;
      let lng = typeof place.lng === 'number' ? place.lng : null;
      if (lat == null || lng == null) {
        const geocoded = await MapsService.geocode(place.address);
        lat = geocoded.lat;
        lng = geocoded.lng;
      }
      return { place, position: [lat, lng], label: summarizePlace(place.typeLabel || place.name) };
    } catch {
      return null;
    }
  }))).filter(Boolean);

  if (!visited.length && !recs.length) {
    const detail = failedLocations.length
      ? `Could not place: ${failedLocations.slice(0, 2).join(' · ')}`
      : 'Could not place today’s locations on the map';
    renderMapEmpty(mapEl, detail);
    return;
  }

  // Reset the container in case the map is being re-rendered.
  mapEl.innerHTML = '';
  if (mapEl._leaflet_id) delete mapEl._leaflet_id;
  mapEl.style.display = 'block';

  const all = [...visited, ...recs];
  const map = L.map(mapEl, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    boxZoom: true,
    touchZoom: true,
    minZoom: 3,
    maxZoom: 19
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap · CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  if (all.length > 1) {
    map.fitBounds(L.latLngBounds(all.map(item => item.position)), { padding: [40, 40] });
  } else {
    map.setView(all[0].position, 14);
  }

  const visitedColors = ['#7B61FF', '#57C7A3', '#F2C14E', '#4EA5D9', '#B66DFF'];
  visited.forEach((item, i) => {
    const size = Math.min(34, Math.max(15, 12 + item.minutes / 8));
    const color = visitedColors[i % visitedColors.length];
    L.marker(item.position, {
      icon: makeDotIcon({
        label: item.label,
        size,
        color,
        meta: `${item.minutes} min`
      })
    })
      .bindPopup(buildVisitedPopup(item, color), { className: 'map-popup-wrap', maxWidth: 260 })
      .addTo(map);
  });

  recs.forEach(item => {
    const style = recStyle(item.place.type);
    L.marker(item.position, {
      icon: makeDotIcon({
        label: summarizePlace(item.place.name || item.place.typeLabel),
        size: 18,
        color: style.color,
        recommended: true,
        meta: item.place.totalMinutes ? `${item.place.totalMinutes} min total` : ''
      })
    })
      .bindPopup(buildRecommendedPopup(item), { className: 'map-popup-wrap', maxWidth: 280 })
      .addTo(map);
  });

  updateMapLegend(recs);

  await drawDashedRouteLegs(map, visited);
}

function renderMapEmpty(mapEl, message) {
  mapEl.innerHTML = `
    <div class="map-empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 1 8 8c0 5.25-8 13-8 13S4 15.25 4 10a8 8 0 0 1 8-8z"/></svg>
      ${message}
    </div>`;
}

function getEventLocation(event) {
  const location = event?.loc || event?.location || event?.place || '';
  return typeof location === 'string' ? location.trim() : '';
}

function summarizePlace(text) {
  const cleaned = (text || 'Stop')
    .replace(/^Stop:\s*/i, '')
    .replace(/\b(with|at|appointment|appt|reservation)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean);
  return words.slice(0, 2).join(' ') || 'Stop';
}

function estimateEventDuration(events, index) {
  const explicitDuration = Number(events[index]?.durationMinutes);
  if (Number.isFinite(explicitDuration) && explicitDuration > 0) return Math.min(240, Math.max(15, explicitDuration));

  const start = events[index]?.date ? new Date(events[index].date) : null;
  const end = events[index]?.end ? new Date(events[index].end) : null;
  if (start && end && !Number.isNaN(start) && !Number.isNaN(end) && end > start) {
    return Math.min(240, Math.max(15, Math.round((end - start) / 60000)));
  }

  const current = parseTodayMapTime(events[index]?.time);
  const next = parseTodayMapTime(events[index + 1]?.time);
  if (current != null && next != null && next > current) return Math.min(180, Math.max(20, next - current));
  return 45;
}

function parseTodayMapTime(timeStr) {
  const match = (timeStr || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = (match[3] || '').toUpperCase();
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

async function drawDashedRouteLegs(map, stops) {
  if (stops.length < 2) return;
  for (let i = 0; i < stops.length - 1; i++) {
    const from = { lat: stops[i].position[0], lng: stops[i].position[1] };
    const to = { lat: stops[i + 1].position[0], lng: stops[i + 1].position[1] };
    const result = await MapsService.route(from, to, 'driving');
    const path = result?.coordinates?.length ? result.coordinates : [stops[i].position, stops[i + 1].position];
    L.polyline(path, {
      color: '#B9B8BE',
      weight: 3,
      opacity: 0.85,
      dashArray: '6 8',
      lineCap: 'round'
    }).addTo(map);
  }
}

// Default categories pulled when seeding the map with variety.
const RECOMMENDATION_CATEGORIES = [
  { id: 'cafes', label: 'Cafe', osmFilters: ['amenity=cafe'], visitMinutes: 35 },
  { id: 'dining', label: 'Dining', osmFilters: ['amenity=restaurant'], visitMinutes: 70 },
  { id: 'museums', label: 'Museum', osmFilters: ['tourism=museum', 'tourism=gallery'], visitMinutes: 90 },
  { id: 'sightseeing', label: 'Sightseeing', osmFilters: ['tourism=attraction', 'tourism=viewpoint'], visitMinutes: 45 },
  { id: 'bookstores', label: 'Bookstore', osmFilters: ['shop=books'], visitMinutes: 30 },
  { id: 'ice-cream', label: 'Ice cream', osmFilters: ['amenity=ice_cream', 'shop=ice_cream'], visitMinutes: 20 }
];

// Distinct color + short tag per recommended category so each is visually
// recognizable on the map. Kept separate from the visited palette to avoid
// confusion between "where you went" and "where you might go".
const REC_CATEGORY_STYLE = {
  cafes:        { color: '#3FAE89', tag: 'CAFE' },
  dining:       { color: '#EF7A4E', tag: 'DINING' },
  drinks:       { color: '#9D5BE0', tag: 'DRINKS' },
  snacks:       { color: '#E0A458', tag: 'SNACKS' },
  'ice-cream':  { color: '#F28FBA', tag: 'ICE CREAM' },
  thrift:       { color: '#C97A4C', tag: 'THRIFT' },
  bookstores:   { color: '#9072F0', tag: 'BOOKS' },
  museums:      { color: '#3D8ABF', tag: 'MUSEUM' },
  sightseeing:  { color: '#E85D75', tag: 'SIGHTS' }
};
const REC_DEFAULT_STYLE = { color: '#E85D75', tag: 'RECOMMENDED' };
function recStyle(typeId) {
  return REC_CATEGORY_STYLE[typeId] || REC_DEFAULT_STYLE;
}

// Pull a handful of nearby spots across categories so the map always has
// variety. Persists the merged list via Store.
async function loadDefaultRecommendations(anchorAddress) {
  const results = await Promise.all(RECOMMENDATION_CATEGORIES.map(async category => {
    try {
      const places = await MapsService.searchPlaces({
        centerAddress: anchorAddress,
        radiusMiles: 1,
        placeType: category
      });
      return places.slice(0, 2).map((place, i) => ({
        ...place,
        id: place.placeId || `seed-${category.id}-${Date.now()}-${i}`,
        type: category.id,
        typeLabel: category.label,
        visitMinutes: category.visitMinutes,
        why: `${category.label} within 1 mi of your day.`
      }));
    } catch {
      return [];
    }
  }));

  const seen = new Set();
  const merged = results.flat().filter(p => {
    const key = `${p.name}-${p.lat.toFixed(4)}-${p.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (merged.length) Store.setRecommendedPlaces(merged);
  return merged;
}

// Wired to the "Refresh recs" button next to the map legend.
async function refreshMapRecommendations(event) {
  if (event) event.stopPropagation();
  const btn = document.getElementById('map-rec-refresh');
  const original = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const events = Store.calendarEvents || [];
    const anchor = getEventLocation(events.find(getEventLocation)) || 'Seattle, WA';
    await loadDefaultRecommendations(anchor);
    renderToday();
  } catch (err) {
    console.error('Refresh recs failed:', err);
    alert(`Could not load recommendations: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original || 'Refresh recs'; }
  }
}
window.refreshMapRecommendations = refreshMapRecommendations;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function buildVisitedPopup(item, color) {
  const e = item.event || {};
  const loc = getEventLocation(e);
  return `
    <div class="map-popup">
      <div class="map-popup-tag" style="background:${color}22;color:${color};border-color:${color}55">VISITED</div>
      <div class="map-popup-name">${escapeHtml(e.title || 'Stop')}</div>
      ${e.time ? `<div class="map-popup-meta">${escapeHtml(e.time)}${e.eta ? ` · ${escapeHtml(e.eta)} away` : ''}</div>` : ''}
      ${loc ? `<div class="map-popup-loc">${escapeHtml(loc)}</div>` : ''}
      <div class="map-popup-stat-row">
        <span class="map-popup-stat">~${item.minutes} min spent</span>
        ${e.depart ? `<span class="map-popup-stat">leave ${escapeHtml(e.depart)}</span>` : ''}
      </div>
    </div>
  `;
}

function buildRecommendedPopup(item) {
  const p = item.place || {};
  const lat = item.position[0];
  const lng = item.position[1];
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name || ''} ${p.address || ''}`)}`;
  const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
  return `
    <div class="map-popup is-recommended">
      <div class="map-popup-tag is-rec">RECOMMENDED</div>
      <div class="map-popup-name">${escapeHtml(p.name || 'Suggested spot')}</div>
      ${p.typeLabel ? `<div class="map-popup-meta">${escapeHtml(p.typeLabel)}</div>` : ''}
      ${p.address ? `<div class="map-popup-loc">${escapeHtml(p.address)}</div>` : ''}
      <div class="map-popup-stat-row">
        ${p.mode && p.oneWayMinutes ? `<span class="map-popup-stat">${escapeHtml(p.mode)} · ${p.oneWayMinutes} min each way</span>` : ''}
        ${p.visitMinutes ? `<span class="map-popup-stat">stay ~${p.visitMinutes} min</span>` : ''}
        ${p.totalMinutes ? `<span class="map-popup-stat strong">${p.totalMinutes} min total</span>` : ''}
      </div>
      ${p.why ? `<div class="map-popup-why">${escapeHtml(p.why)}</div>` : ''}
      <div class="map-popup-actions">
        <a class="map-popup-btn" href="${mapsUrl}" target="_blank" rel="noopener">Open in Maps</a>
        <a class="map-popup-btn ghost" href="${osmUrl}" target="_blank" rel="noopener">View on OSM</a>
      </div>
    </div>
  `;
}

function makeDotIcon({ label, size, color, recommended = false, meta = '', pillText = 'RECOMMENDED', pillColor = '#E85D75' }) {
  const tile = 200;
  return L.divIcon({
    className: `map-dot-overlay ${recommended ? 'is-recommended' : ''}`,
    html: `
      ${recommended ? `<div class="map-rec-label" style="background:${pillColor};border-color:${pillColor}">${pillText}</div>` : ''}
      <div class="map-dot-label">${label}</div>
      <div class="map-dot" style="width:${size}px;height:${size}px;background:${color};box-shadow:0 0 0 ${Math.round(size / 2)}px ${color}22"></div>
      ${meta ? `<div class="map-dot-meta">${meta}</div>` : ''}
    `,
    iconSize: [tile, tile],
    iconAnchor: [tile / 2, tile / 2]
  });
}

// Rebuild the legend so each on-map category gets its own colored swatch.
function updateMapLegend(recs) {
  const legendEl = document.getElementById('map-legend');
  if (!legendEl) return;

  const counts = {};
  recs.forEach(r => {
    const t = r.place?.type || 'default';
    counts[t] = (counts[t] || 0) + 1;
  });

  const orderedTypes = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([typeId]) => typeId);

  const categoryItems = orderedTypes.map(typeId => {
    const s = recStyle(typeId);
    return `
      <span class="legend-cat">
        <i class="legend-dot" style="background:${s.color}"></i>
        ${s.tag.toLowerCase()}
        <span class="legend-count" style="background:${s.color}">${counts[typeId]}</span>
      </span>`;
  }).join('');

  legendEl.innerHTML = `
    <span><i class="legend-dot visited"></i> visited</span>
    ${categoryItems || '<span class="legend-empty">no recs yet</span>'}
    <button class="map-rec-refresh" id="map-rec-refresh" onclick="refreshMapRecommendations(event)">Refresh recs</button>
  `;
}