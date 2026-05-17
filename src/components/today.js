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
            ${e.loc ? `<div class="cal-loc">${e.loc}</div>` : '<div class="cal-loc" style="color:var(--text3)">Remote</div>'}
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
        <div class="stat-val">${sortedEvents.filter(e=>e.loc).length}</div>
        <div class="stat-lbl">trips today</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${sortedEvents.filter(e=>e.loc).reduce((a,e)=>a+parseInt(e.eta||0),0)} min</div>
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
      <div class="card-label">Route map</div>
      <div id="map" class="map-box"></div>
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
  const mapEvents = sortedEvents.filter(e => e.loc && e.date && e.date.split('T')[0] === todayStr);
  initRouteMap(mapEvents);
}

// ── Route map ─────────────────────────────────────────────────────────────────
// Renders a Google Map in #map with numbered markers for each today event that
// has a location, connected by a Directions route line in chronological order.
async function initRouteMap(events) {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  const apiKey = typeof GOOGLE_API_KEY !== 'undefined' ? GOOGLE_API_KEY : '';

  // Show a placeholder if no API key or no events with locations today.
  if (!apiKey || apiKey === '---' || !events.length) {
    mapEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--text3);font-size:12px">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 1 8 8c0 5.25-8 13-8 13S4 15.25 4 10a8 8 0 0 1 8-8z"/></svg>
        ${events.length ? 'Add your Google API key to see the map' : 'No locations on your calendar today'}
      </div>`;
    return;
  }

  // Load the Maps JS API dynamically (once).
  await loadMapsApi(apiKey);

  const { Map, Geocoder, DirectionsService, DirectionsRenderer, Polyline, Marker, InfoWindow } = await loadMapsLibraries();

  // Accent color from CSS vars.
  const ACCENT = '#39275B';
  const COLORS = ['#b8f55a','#5acfff','#7de8a0','#f5c842','#ff6b6b','#c77dff'];

  // Geocode all event locations in parallel.
  const geocoder = new Geocoder();
  const geocoded = await Promise.all(events.map(async (e, i) => {
    try {
      const result = await new Promise((res, rej) => {
        geocoder.geocode({ address: e.loc }, (results, status) => {
          status === 'OK' ? res(results[0]) : rej(status);
        });
      });
      return { event: e, position: result.geometry.location, index: i };
    } catch {
      return null;
    }
  }));

  const valid = geocoded.filter(Boolean);
  if (!valid.length) {
    mapEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text3);font-size:12px">Couldn't geocode today's locations</div>`;
    return;
  }

  // Build the map centered on the midpoint of all locations.
  const avgLat = valid.reduce((s, g) => s + g.position.lat(), 0) / valid.length;
  const avgLng = valid.reduce((s, g) => s + g.position.lng(), 0) / valid.length;

  const map = new Map(mapEl, {
    center: { lat: avgLat, lng: avgLng },
    zoom: valid.length === 1 ? 15 : 13,
    disableDefaultUI: true,
    zoomControl: true,
    mapTypeControl: false,
    styles: [
      { elementType: 'geometry', stylers: [{ color: '#f5f0ff' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ddd6f3' }] },
      { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#cfc4ef' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c5d8ff' }] },
      { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#d4f0c8' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#39275B' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    ],
  });

  const infoWindow = new InfoWindow();

  // Drop a numbered marker for each location.
  valid.forEach(({ event, position, index }) => {
    const color = COLORS[index % COLORS.length];
    const label = String(index + 1);

    const marker = new Marker({
      position,
      map,
      title: event.title,
      label: {
        text: label,
        color: ACCENT,
        fontFamily: 'DM Mono, monospace',
        fontSize: '11px',
        fontWeight: '700',
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 16,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: ACCENT,
        strokeWeight: 1.5,
      },
    });

    marker.addListener('click', () => {
      infoWindow.setContent(`
        <div style="font-family:DM Mono,monospace;padding:4px 2px;min-width:140px">
          <div style="font-weight:600;font-size:13px;color:#39275B;margin-bottom:3px">${event.title}</div>
          <div style="font-size:11px;color:#666">${event.time}</div>
          <div style="font-size:11px;color:#888;margin-top:2px">${event.loc}</div>
        </div>
      `);
      infoWindow.open(map, marker);
    });
  });

  // Draw a Directions route between all stops if there are 2+.
  if (valid.length >= 2) {
    const directionsService = new DirectionsService();
    const origin = valid[0].position;
    const destination = valid[valid.length - 1].position;
    const waypoints = valid.slice(1, -1).map(g => ({ location: g.position, stopover: false }));

    directionsService.route(
      { origin, destination, waypoints, travelMode: google.maps.TravelMode.DRIVING },
      (result, status) => {
        if (status === 'OK') {
          const renderer = new DirectionsRenderer({
            map,
            suppressMarkers: true, // keep our custom markers
            polylineOptions: {
              strokeColor: ACCENT,
              strokeOpacity: 0.5,
              strokeWeight: 3,
            },
          });
          renderer.setDirections(result);
        }
      }
    );
  }

  // Fit the map to show all markers.
  if (valid.length > 1) {
    const bounds = new google.maps.LatLngBounds();
    valid.forEach(g => bounds.extend(g.position));
    map.fitBounds(bounds, { top: 32, right: 32, bottom: 32, left: 32 });
  }
}

// Load the Maps JS API script once and resolve when ready.
function loadMapsApi(apiKey) {
  if (window._mapsApiReady) return Promise.resolve();
  if (window._mapsApiPromise) return window._mapsApiPromise;

  window._mapsApiPromise = new Promise((resolve, reject) => {
    if (document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')) {
      // Script already injected — wait for it.
      const check = setInterval(() => {
        if (window.google?.maps) { clearInterval(check); resolve(); }
      }, 100);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`;
    script.async = true;
    script.onload = () => { window._mapsApiReady = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return window._mapsApiPromise;
}

// Pull the Maps classes we need from the global google.maps namespace.
async function loadMapsLibraries() {
  const g = google.maps;
  return {
    Map: g.Map,
    Geocoder: g.Geocoder,
    DirectionsService: g.DirectionsService,
    DirectionsRenderer: g.DirectionsRenderer,
    Marker: g.Marker,
    InfoWindow: g.InfoWindow,
  };
}