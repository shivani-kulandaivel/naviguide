// ── Discover tab ────────────────────────────────────────────────────────────
// Responsible for suggesting local places based on the user's calendar,
// rendering cards, handling filters, scheduling stops, and calling AI.

const DiscoverState = {
  cards: [],          // { id, name, type, address, why, vicinity, imgUrl, addedTo }
  loading: false,
  activeFilter: 'all',
  scheduleModal: null,
};

// Static seed cards shown before AI loads
const SEED_CARDS = [
  {
    id: 'seed-1',
    name: 'Broadcast Coffee',
    type: 'café',
    address: '2136 Queen Anne Ave N, Seattle',
    why: '0.1 mi off your AM commute · opens 7am',
    vicinity: 'Queen Anne',
    imgUrl: 'https://maps.googleapis.com/maps/api/streetview?size=400x300&location=2136+Queen+Anne+Ave+N,+Seattle,+WA&key=DEMO_KEY&fov=80',
    addedTo: null,
  },
  {
    id: 'seed-2',
    name: 'Mkt. to Table',
    type: 'restaurant',
    address: 'Pike St, Capitol Hill, Seattle',
    why: 'Near your 12pm Capitol Hill lunch spot',
    vicinity: 'Capitol Hill',
    imgUrl: 'https://maps.googleapis.com/maps/api/streetview?size=400x300&location=Pike+St,+Capitol+Hill,+Seattle,+WA&key=DEMO_KEY&fov=80',
    addedTo: null,
  },
  {
    id: 'seed-3',
    name: "Volunteer Park",
    type: 'park',
    address: '1247 15th Ave E, Seattle',
    why: 'Good wind-down between dentist & gym',
    vicinity: 'First Hill',
    imgUrl: 'https://maps.googleapis.com/maps/api/streetview?size=400x300&location=Volunteer+Park,+Seattle,+WA&key=DEMO_KEY&fov=80',
    addedTo: null,
  },
  {
    id: 'seed-4',
    name: "Metropolitan Market",
    type: 'market',
    address: '1908 Queen Anne Ave N, Seattle',
    why: 'Natural grocery stop on gym→home route',
    vicinity: 'Queen Anne',
    imgUrl: 'https://maps.googleapis.com/maps/api/streetview?size=400x300&location=1908+Queen+Anne+Ave+N,+Seattle,+WA&key=DEMO_KEY&fov=80',
    addedTo: null,
  },
  {
    id: 'seed-5',
    name: "Elliott Bay Book Co.",
    type: 'bookstore',
    address: '1521 10th Ave, Capitol Hill',
    why: 'Browse before your Capitol Hill lunch',
    vicinity: 'Capitol Hill',
    imgUrl: 'https://maps.googleapis.com/maps/api/streetview?size=400x300&location=Elliott+Bay+Book+Co,+Capitol+Hill,+Seattle&key=DEMO_KEY&fov=80',
    addedTo: null,
  },
  {
    id: 'seed-6',
    name: "Spinasse",
    type: 'restaurant',
    address: '1531 14th Ave, Capitol Hill',
    why: 'Highly rated Italian near your lunch area',
    vicinity: 'Capitol Hill',
    imgUrl: 'https://maps.googleapis.com/maps/api/streetview?size=400x300&location=Spinasse,+Capitol+Hill,+Seattle&key=DEMO_KEY&fov=80',
    addedTo: null,
  },
];

const TYPE_EMOJI = {
  café: '☕', restaurant: '🍽️', park: '🌿', market: '🛒',
  bookstore: '📚', bar: '🍸', gallery: '🖼️', gym: '🏋️',
  shop: '🛍️', bakery: '🥐', default: '📍',
};

const TYPE_COLOR = {
  café: '#b8f55a', restaurant: '#7de8a0', park: '#5acfff',
  market: '#f5c842', bookstore: '#c77dff', bar: '#ff9f7f',
  gallery: '#ffc0f0', gym: '#5acfff', shop: '#f5c842',
  bakery: '#b8f55a', default: '#c1abeb',
};

// Convert a 12-hour time string into minutes since midnight for schedule math.
function timeStringToMinutes(timeStr) {
  const match = (timeStr || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const ampm = (match[3] || '').toUpperCase();
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

// Convert minutes since midnight back into a friendly AM/PM time label.
function minutesToTimeString(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalizedHour}:${String(minute).padStart(2, '0')} ${ampm}`;
}

// Estimate how long a stop of each type will take for scheduling suggestions.
function getEstimatedVisitDuration(type) {
  if (type === 'restaurant') return 60;
  if (type === 'café') return 40;
  if (type === 'park') return 45;
  if (type === 'market') return 35;
  if (type === 'bookstore') return 40;
  if (type === 'gym') return 50;
  return 45;
}

// Identify available time gaps between today's calendar events for new stops.
function buildScheduleGaps(events, minVisitMinutes) {
  const todayStart = 8 * 60;
  const todayEnd = 22 * 60;
  // Sort todays calendar events so we can discover gaps between them.
  const sortedEvents = [...events]
    .map(e => ({ ...e, minutes: timeStringToMinutes(e.time) }))
    .filter(e => typeof e.minutes === 'number')
    .sort((a, b) => a.minutes - b.minutes);

  const gaps = [];
  let previousEnd = todayStart;

  sortedEvents.forEach(event => {
    // If there is free time before this event, add it as a possible gap.
    if (event.minutes > previousEnd) {
      const gapDuration = event.minutes - previousEnd;
      gaps.push({
        startMin: previousEnd,
        endMin: event.minutes,
        duration: gapDuration,
        label: `${minutesToTimeString(previousEnd)} — ${minutesToTimeString(event.minutes)}`,
        color: gapDuration >= minVisitMinutes * 2 ? '#d2f8d6' : gapDuration >= minVisitMinutes ? '#fff3c4' : '#ffd6d6',
        badge: gapDuration >= minVisitMinutes * 2 ? 'Spacious' : gapDuration >= minVisitMinutes ? 'OK' : 'Tight',
      });
    }
    previousEnd = Math.max(previousEnd, event.minutes + 30);
  });

  // If there is remaining free time after the last event, add an evening gap.
  if (todayEnd > previousEnd) {
    const gapDuration = todayEnd - previousEnd;
    gaps.push({
      startMin: previousEnd,
      endMin: todayEnd,
      duration: gapDuration,
      label: `${minutesToTimeString(previousEnd)} — ${minutesToTimeString(todayEnd)}`,
      color: gapDuration >= minVisitMinutes * 2 ? '#d2f8d6' : gapDuration >= minVisitMinutes ? '#fff3c4' : '#ffd6d6',
      badge: gapDuration >= minVisitMinutes * 2 ? 'Spacious' : gapDuration >= minVisitMinutes ? 'OK' : 'Tight',
    });
  }

  return gaps;
}

// Return today's calendar events that include a location and a time.
function getTodayEvents() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return Store.calendarEvents
    .filter(e => e.date && e.date.split('T')[0] === today && e.time && e.time !== '—' && e.time !== 'All Day');
}

// Render the Discover tab UI, including filters, cards, and search controls.
function renderDiscover() {
  const pane = document.getElementById('tab-discover');

  // Init with seed cards if empty
  if (DiscoverState.cards.length === 0) {
    DiscoverState.cards = SEED_CARDS.map(c => ({ ...c }));
  }

  pane.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Discover</div>
        <div class="page-sub">Spots that fit your routes & calendar</div>
      </div>
      <button class="btn-primary disc-refresh-btn" onclick="discoverRefresh()" style="font-size:12px;padding:8px 14px;display:flex;align-items:center;gap:6px">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M11.5 6.5a5 5 0 1 1-1.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11.5 2v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Refresh with AI
      </button>
    </div>

    <!-- Context strip -->
    <div class="disc-context-strip" id="disc-context-strip">
      ${buildContextStrip()}
    </div>

    <!-- Filter chips -->
    <div class="disc-filters" id="disc-filters">
      ${buildFilterChips()}
    </div>

    <!-- AI loading banner -->
    <div class="disc-ai-banner" id="disc-ai-banner" style="display:none">
      <div class="disc-ai-spinner"></div>
      <span>Searching nearby spots along your routes…</span>
    </div>

    <!-- Card grid -->
    <div class="disc-grid" id="disc-grid">
      ${buildCardGrid()}
    </div>

    <!-- Ask AI row -->
    <div class="card" style="margin-top:6px">
      <div class="card-label">Find something specific</div>
      <div class="form-grid" style="grid-template-columns:1fr auto">
        <input type="text" id="disc-q" placeholder="e.g. quiet wine bars near Capitol Hill" />
        <button class="btn-primary" onclick="discoverSearch()">Search</button>
      </div>
      <div class="ai-response" id="disc-ai-out"></div>
    </div>

    <!-- Schedule modal portal -->
    <div id="disc-modal-root"></div>
  `;
}

// Try to create a Google Calendar event on behalf of the user.
// If authorization is missing, it triggers the auth flow and retries.
// Try creating a Google event and, if auth is missing, trigger login and retry.
async function tryCreateGoogleEventWithAuth(resource, timeout = 15000) {
  if (typeof window.createGoogleCalendarEvent !== 'function') return null;

  // Attempt to create the event immediately if we already have auth.
  try {
    const res = await window.createGoogleCalendarEvent(resource);
    if (res) return res;
  } catch (e) {
    console.warn('Initial Google create failed', e);
  }

  // If not created, trigger auth flow if available
  if (typeof window.loadGoogleCalendar === 'function') {
    // Trigger the Google sign-in flow if authorization failed the first time.
    try {
      window.loadGoogleCalendar();
    } catch (e) { console.warn('loadGoogleCalendar failed', e); }
  }

  // Poll for up to timeout ms to see if creation succeeds after auth
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const res2 = await window.createGoogleCalendarEvent(resource);
      if (res2) return res2;
    } catch (e) {
      // ignore and retry
    }
  }

  return null;
}

// ── Context strip ────────────────────────────────────────────────────────────
// Build the context strip that shows today's calendar locations for the Discover tab.
function buildContextStrip() {
  const events = getTodayEvents().filter(e => getDiscoverEventLocation(e));
  if (!events.length) return '';
  return `
    <div class="disc-context-label">Today's locations</div>
    <div class="disc-context-pills">
      ${events.map(e => `
        <div class="disc-context-pill">
          <span class="disc-context-time">${e.time}</span>
          <span>${getDiscoverEventLocation(e)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Filter chips ─────────────────────────────────────────────────────────────
// Build filter chip buttons for each type of suggested place.
function buildFilterChips() {
  const types = ['all', ...new Set(DiscoverState.cards.map(c => c.type))];
  return types.map(t => `
    <button
      class="disc-filter-chip ${DiscoverState.activeFilter === t ? 'active' : ''}"
      onclick="discoverSetFilter('${t}')"
    >${t === 'all' ? '✦ All' : (TYPE_EMOJI[t] || '📍') + ' ' + t}</button>
  `).join('');
}

// ── Card grid ────────────────────────────────────────────────────────────────
// Build the card grid markup for displayed suggestion cards.
function buildCardGrid() {
  const filtered = DiscoverState.activeFilter === 'all'
    ? DiscoverState.cards
    : DiscoverState.cards.filter(c => c.type === DiscoverState.activeFilter);

  if (!filtered.length) return '<div class="empty" style="grid-column:1/-1;padding:40px 0">No spots found — try a different filter or refresh</div>';

  return filtered.map(c => buildCard(c)).join('');
}

// Render a single discovery card for a suggested place.
function buildCard(c) {
  const emoji = TYPE_EMOJI[c.type] || TYPE_EMOJI.default;
  const color = TYPE_COLOR[c.type] || TYPE_COLOR.default;
  const added = c.addedTo;

  // Use Google Maps Static API embed (no key needed for embed iframe, streetview needs key)
  // We'll use a stylized placeholder with the Maps embed link
  const mapEmbedUrl = `https://www.google.com/maps/embed/v1/place?key=AIzaSyD-placeholder&q=${encodeURIComponent(c.address)}&zoom=16`;
  const staticImgUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(c.address)}&zoom=16&size=400x220&maptype=roadmap&markers=color:0x39275B%7C${encodeURIComponent(c.address)}&style=element:geometry%7Ccolor:0xf5f0ff&style=feature:road%7Celement:geometry%7Ccolor:0xddd6f3&key=DEMO_KEY`;

  return `
    <div class="disc-card" id="card-${c.id}">
      <!-- Image area -->
      <div class="disc-card-img" style="background:linear-gradient(135deg, ${color}22, ${color}44)">
        <div class="disc-card-img-inner">
          <!-- Stylized map preview using CSS art -->
          <div class="disc-map-art" style="--card-color:${color}">
            <div class="disc-map-grid"></div>
            <div class="disc-map-marker">
              <div class="disc-map-marker-dot" style="background:${color}"></div>
              <div class="disc-map-marker-ring" style="border-color:${color}40"></div>
            </div>
            <div class="disc-map-label">${c.vicinity || c.address.split(',')[1]?.trim() || ''}</div>
          </div>
        </div>
        <div class="disc-card-type-badge" style="background:${color}22;color:${color};border-color:${color}33">
          ${emoji} ${c.type}
        </div>
        ${added ? `<div class="disc-card-added-badge">✓ Added to ${added}</div>` : ''}
      </div>

      <!-- Content -->
      <div class="disc-card-body">
        <div class="disc-card-name">${c.name}</div>
        <div class="disc-card-address">${c.address}</div>
        <div class="disc-card-why" style="color:${color}">${c.why}</div>

        <!-- Actions -->
        <div class="disc-card-actions">
          <button class="disc-card-btn-primary" onclick="discoverAddToSchedule('${c.id}')">
            ${added ? '✓ Scheduled' : '+ Add to schedule'}
          </button>
          <button class="disc-card-btn-secondary" onclick="discoverOpenMaps('${c.id}')">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M6 11S2 7.5 2 5a4 4 0 1 1 8 0c0 2.5-4 6-4 6z" stroke="currentColor" stroke-width="1.2"/></svg>
            Maps
          </button>
        </div>
      </div>
    </div>
  `;
}

// ── Actions ──────────────────────────────────────────────────────────────────
// Apply a selected place-type filter and refresh the card grid.
function discoverSetFilter(type) {
  DiscoverState.activeFilter = type;
  const grid = document.getElementById('disc-grid');
  const filters = document.getElementById('disc-filters');
  if (grid) grid.innerHTML = buildCardGrid();
  if (filters) filters.innerHTML = buildFilterChips();
}

// Open the selected place in Google Maps.
function discoverOpenMaps(id) {
  const card = DiscoverState.cards.find(c => c.id === id);
  if (!card) return;
  window.open(`https://www.google.com/maps/search/${encodeURIComponent(card.name + ' ' + card.address)}`, '_blank');
}

// Begin the schedule add flow for a selected suggestion card.
function discoverAddToSchedule(id) {
  const card = DiscoverState.cards.find(c => c.id === id);
  if (!card) return;
  showScheduleModal(card);
}

// Show a modal where the user can choose when to schedule a suggested stop.
function showScheduleModal(card) {
  const root = document.getElementById('disc-modal-root');
  if (!root) return;

  const events = getTodayEvents();
  const estimatedDuration = getEstimatedVisitDuration(card.type);
  const gaps = buildScheduleGaps(events, estimatedDuration);
  DiscoverState.scheduleGaps = gaps;
  const color = TYPE_COLOR[card.type] || TYPE_COLOR.default;
  const emoji = TYPE_EMOJI[card.type] || '📍';

  root.innerHTML = `
    <div class="disc-modal-overlay" onclick="closeScheduleModal()">
      <div class="disc-modal" onclick="event.stopPropagation()">
        <div class="disc-modal-header" style="border-color:${color}33">
          <div class="disc-modal-icon" style="background:${color}22;border-color:${color}33">${emoji}</div>
          <div>
            <div class="disc-modal-title">${card.name}</div>
            <div class="disc-modal-sub">${card.address}</div>
          </div>
          <button class="disc-modal-close" onclick="closeScheduleModal()">✕</button>
        </div>

        <div class="disc-modal-body">
          <div class="disc-modal-label">Estimated visit</div>
          <div class="disc-modal-sub" style="margin-bottom:12px">${estimatedDuration} min estimated stay for this stop</div>

          <div class="disc-modal-label">Choose a gap</div>
          <div class="disc-modal-gaps">
            ${gaps.length ? gaps.map((gap, i) => `
              <button class="disc-modal-gap-btn" onclick="confirmAddToSchedule('${card.id}', ${i})" style="background:${gap.color};">
                <div>
                  <div class="disc-modal-gap-time">${gap.label}</div>
                  <div class="disc-modal-gap-badge">${gap.badge}</div>
                </div>
                <div class="disc-modal-gap-duration">${gap.duration} min available</div>
              </button>
            `).join('') : '<div class="disc-modal-empty">No available gaps found today. Use manual add below.</div>'}
          </div>

          <div class="disc-modal-label" style="margin-top:16px">Or add with a custom time</div>
          <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:8px">
            <div class="field">
              <label>Time</label>
              <input type="time" id="modal-custom-time" value="10:00" />
            </div>
            <div class="field">
              <label>Note</label>
              <input type="text" id="modal-custom-note" placeholder="e.g. Quick coffee stop" />
            </div>
          </div>
          <button class="btn-primary" style="width:100%;margin-top:8px" onclick="confirmCustomAdd('${card.id}')">
            Add to today's schedule
          </button>
        </div>
      </div>
    </div>
  `;
}

// Close the schedule modal and remove it from the DOM.
function closeScheduleModal() {
  const root = document.getElementById('disc-modal-root');
  if (root) root.innerHTML = '';
}

// Confirm scheduling a suggested stop into an available gap and add it to calendar.
async function confirmAddToSchedule(cardId, gapIdx) {
  const card = DiscoverState.cards.find(c => c.id === cardId);
  if (!card) return;
  const gap = DiscoverState.scheduleGaps?.[gapIdx];
  const today = getLocalDateString();
  const startTime = gap ? minutesToTimeString(gap.startMin) : '10:00 AM';
  card.addedTo = `Scheduled at ${startTime}`;

  const newEvent = {
    date: today,
    time: startTime,
    title: `Stop: ${card.name}`,
    loc: card.address,
    note: card.why,
  };

  if (typeof window.createGoogleCalendarEvent === 'function') {
    const eventDateTime = window.buildGoogleEventDateTime(startTime);
    const resource = {
      summary: newEvent.title,
      location: newEvent.loc,
      description: newEvent.note,
      start: eventDateTime.start,
      end: eventDateTime.end
    };
    try {
      const result = await tryCreateGoogleEventWithAuth(resource);
      if (result?.id) newEvent.googleId = result.id;
      if (result?.start?.dateTime || result?.start?.date) {
        newEvent.date = result.start.dateTime || result.start.date;
      }
    } catch (err) {
      console.error('Google event create failed', err);
    }
  }

  Store.calendarEvents.push(newEvent);
  Store.calendarEvents.sort((a, b) => {
    const aMin = timeStringToMinutes(a.time) ?? 9999;
    const bMin = timeStringToMinutes(b.time) ?? 9999;
    return aMin - bMin;
  });
  closeScheduleModal();
  Store.setCalendarEvents(Store.calendarEvents);
  refreshDiscoverCards();

  // Re-render today tab if visible
  if (document.getElementById('tab-today')?.classList.contains('active')) {
    renderToday();
  }

  showToast(`${card.name} added to your schedule!`);
}

// Confirm a manually chosen time for a suggested stop and add it to the schedule.
async function confirmCustomAdd(cardId) {
  const card = DiscoverState.cards.find(c => c.id === cardId);
  if (!card) return;
  const timeVal = document.getElementById('modal-custom-time')?.value || '10:00';
  const note = document.getElementById('modal-custom-note')?.value || card.why;

  // Convert 24h to 12h
  const [hh, mm] = timeVal.split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  const timeStr = `${h12}:${String(mm).padStart(2,'0')} ${ampm}`;

  const newEvent = {
    date: getLocalDateString(),
    time: timeStr,
    title: `Stop: ${card.name}`,
    loc: card.address,
    note,
  };

  if (typeof window.createGoogleCalendarEvent === 'function') {
    const eventDateTime = window.buildGoogleEventDateTime(timeStr);
    const resource = {
      summary: newEvent.title,
      location: newEvent.loc,
      description: newEvent.note,
      start: eventDateTime.start,
      end: eventDateTime.end
    };
    try {
      const result = await tryCreateGoogleEventWithAuth(resource);
      if (result?.id) newEvent.googleId = result.id;
      if (result?.start?.dateTime || result?.start?.date) {
        newEvent.date = result.start.dateTime || result.start.date;
      }
    } catch (err) {
      console.error('Google event create failed', err);
    }
  }

  card.addedTo = timeStr;
  Store.calendarEvents.push(newEvent);
  Store.calendarEvents.sort((a, b) => {
    // rough sort by time string
    const toMin = t => {
      const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!m) return 9999;
      let h = parseInt(m[1]); const min = parseInt(m[2]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      return h * 60 + min;
    };
    return toMin(a.time) - toMin(b.time);
  });

  closeScheduleModal();
  Store.setCalendarEvents(Store.calendarEvents);
  refreshDiscoverCards();
  showToast(`${card.name} added at ${timeStr}!`);
}

// Refresh the card grid and filter UI after state changes.
function refreshDiscoverCards() {
  const grid = document.getElementById('disc-grid');
  const filters = document.getElementById('disc-filters');
  if (grid) grid.innerHTML = buildCardGrid();
  if (filters) filters.innerHTML = buildFilterChips();
}

// Show a transient toast notification to the user.
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'disc-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('visible'));
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 400); }, 2800);
}

// ── Places Refresh ────────────────────────────────────────────────────────────
// The current Discover refresh implementation lives below and uses Google Places.

// ── Custom search ────────────────────────────────────────────────────────────
// Search for specific place recommendations via the AI assistant.
async function discoverSearch() {
  const input = document.getElementById('disc-q');
  if (!input?.value.trim()) return;
  const query = input.value.trim();
  input.value = '';

  const outEl = document.getElementById('disc-ai-out');
  if (outEl) { outEl.classList.add('visible'); outEl.innerHTML = '<div class="ai-loading"><div class="ai-spinner"></div>Searching…</div>'; }

  await askAI('disc-ai-out', `User is in Seattle. Their calendar today has events at: ${getTodayEvents().map(getDiscoverEventLocation).filter(Boolean).join(', ')}. They're looking for: "${query}". Suggest 3 specific real places in Seattle that match, mentioning why each fits their current day. Keep it concise.`);
}

// ── OSM Places Discover experience ───────────────────────────────────────────
// `osmFilters` is a list of OSM tag selectors that Overpass uses.
const DISCOVER_GOOGLE_TYPES = [
  { id: 'snacks', label: 'Snacks', osmFilters: ['shop=bakery', 'shop=pastry', 'amenity=fast_food'] },
  { id: 'dining', label: 'Dining', osmFilters: ['amenity=restaurant'] },
  { id: 'drinks', label: 'Drinks', osmFilters: ['amenity=bar', 'amenity=pub'] },
  { id: 'ice-cream', label: 'Ice cream', osmFilters: ['amenity=ice_cream', 'shop=ice_cream'] },
  { id: 'thrift', label: 'Thrift stores', osmFilters: ['shop=second_hand', 'shop=charity'] },
  { id: 'bookstores', label: 'Bookstores', osmFilters: ['shop=books'] },
  { id: 'cafes', label: 'Cafes / coffee', osmFilters: ['amenity=cafe'] },
  { id: 'museums', label: 'Museums', osmFilters: ['tourism=museum', 'tourism=gallery'] },
  { id: 'sightseeing', label: 'Sightseeing', osmFilters: ['tourism=attraction', 'tourism=viewpoint'] }
];

Object.assign(TYPE_COLOR, {
  snacks: '#F2C14E',
  dining: '#57C7A3',
  drinks: '#B66DFF',
  'ice-cream': '#F7A8C8',
  thrift: '#E0A458',
  bookstores: '#7B61FF',
  cafes: '#8ED6C9',
  museums: '#4EA5D9',
  sightseeing: '#E85D75'
});

function getTodayEvents() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return Store.calendarEvents
    .filter(e => {
      const date = e.date ? e.date.split('T')[0] : today;
      return date === today && e.time && e.time !== '—' && e.time !== 'All Day';
    });
}

function getDiscoverEventLocation(event) {
  const location = event?.loc || event?.location || event?.place || '';
  return typeof location === 'string' ? location.trim() : '';
}

function getLocalDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function ensureDiscoverDefaults() {
  if (!DiscoverState.radiusMiles) DiscoverState.radiusMiles = 1;
  if (!DiscoverState.placeType) DiscoverState.placeType = 'cafes';
}

function renderDiscover() {
  ensureDiscoverDefaults();
  const pane = document.getElementById('tab-discover');
  if (!pane) return;
  if (DiscoverState.cards.length === 0) DiscoverState.cards = SEED_CARDS.map(c => ({ ...c }));

  pane.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Discover</div>
        <div class="page-sub">Places nearby with round-trip timing</div>
      </div>
      <button class="btn-primary disc-refresh-btn" onclick="discoverRefresh()">Find places</button>
    </div>

    <div class="disc-control-panel">
      <div class="field">
        <label>Mile radius</label>
        <select id="disc-radius" onchange="discoverSetRadius(this.value)">
          ${[0.5, 1, 2, 3, 5].map(v => `<option value="${v}" ${Number(DiscoverState.radiusMiles) === v ? 'selected' : ''}>${v} mi</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Place type</label>
        <select id="disc-place-type" onchange="discoverSetPlaceType(this.value)">
          ${DISCOVER_GOOGLE_TYPES.map(t => `<option value="${t.id}" ${DiscoverState.placeType === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="disc-control-copy">
        Searching around <strong>${getDiscoveryAnchor()}</strong>. Each card picks walk vs transit, with driving as the fallback.
      </div>
    </div>

    <div class="disc-context-strip" id="disc-context-strip">
      ${buildContextStrip()}
    </div>

    <div class="disc-ai-banner" id="disc-ai-banner" style="display:none">
      <div class="disc-ai-spinner"></div>
      <span>Looking up nearby places and travel times…</span>
    </div>

    <div class="disc-grid" id="disc-grid">
      ${buildCardGrid()}
    </div>

    <div class="card" style="margin-top:6px">
      <div class="card-label">Find something specific</div>
      <div class="form-grid" style="grid-template-columns:1fr auto">
        <input type="text" id="disc-q" placeholder="e.g. quiet dessert spots near my next stop" />
        <button class="btn-primary" onclick="discoverSearch()">Search</button>
      </div>
      <div class="ai-response" id="disc-ai-out"></div>
    </div>

    <div id="disc-modal-root"></div>
  `;
}

function discoverSetRadius(value) {
  DiscoverState.radiusMiles = Number(value);
}

function discoverSetPlaceType(value) {
  DiscoverState.placeType = value;
}

function getDiscoveryAnchor() {
  const locEvent = getTodayEvents().find(e => getDiscoverEventLocation(e));
  return getDiscoverEventLocation(locEvent) || 'Seattle, WA';
}

function buildCardGrid() {
  const cards = DiscoverState.activeFilter === 'all'
    ? DiscoverState.cards
    : DiscoverState.cards.filter(c => c.type === DiscoverState.activeFilter);
  if (!cards.length) return '<div class="empty" style="grid-column:1/-1;padding:40px 0">No spots yet. Pick a radius and type, then find places.</div>';
  return cards.map(c => buildCard(c)).join('');
}

function buildCard(c) {
  const typeDef = DISCOVER_GOOGLE_TYPES.find(t => t.id === c.type);
  const label = c.typeLabel || typeDef?.label || c.type || 'Place';
  const color = TYPE_COLOR[c.type] || TYPE_COLOR[c.typeLabel] || TYPE_COLOR.default;
  const modeText = c.mode ? `${c.mode} there` : 'route pending';
  const spendText = c.visitMinutes ? `${c.visitMinutes} min there` : `${getEstimatedVisitDuration(c.type)} min there`;
  const totalText = c.totalMinutes ? `${c.totalMinutes} min total` : 'timing pending';
  const rating = c.rating ? `${c.rating.toFixed(1)} ★${c.userRatingsTotal ? ` (${c.userRatingsTotal})` : ''}` : 'Google place';

  return `
    <div class="disc-card" id="card-${c.id}">
      <div class="disc-card-img" style="background:linear-gradient(135deg, ${color}20, #ffffff 70%)">
        <div class="disc-rec-ribbon">Recommended</div>
        <div class="disc-map-art" style="--card-color:${color}">
          <div class="disc-map-grid"></div>
          <div class="disc-map-marker">
            <div class="disc-map-marker-dot" style="background:${color}"></div>
            <div class="disc-map-marker-ring" style="border-color:${color}40"></div>
          </div>
          <div class="disc-map-label">${c.vicinity || c.address}</div>
        </div>
        <div class="disc-card-type-badge" style="background:${color}22;color:${color};border-color:${color}33">${label}</div>
        ${c.addedTo ? `<div class="disc-card-added-badge">Added</div>` : ''}
      </div>

      <div class="disc-card-body">
        <div class="disc-card-name">${c.name}</div>
        <div class="disc-card-address">${c.address}</div>
        <div class="disc-card-why" style="color:${color}">${c.why || `${rating} within ${DiscoverState.radiusMiles} mi of your day.`}</div>
        <div class="disc-time-stack">
          <span>${modeText}</span>
          <span>${c.oneWayMinutes ? `${c.oneWayMinutes} min each way` : 'calculating travel'}</span>
          <span>${spendText}</span>
          <strong>${totalText}</strong>
        </div>

        <div class="disc-card-actions">
          <button class="disc-card-btn-primary" onclick="discoverAddToSchedule('${c.id}')">
            ${c.addedTo ? 'Scheduled' : '+ Add'}
          </button>
          <button class="disc-card-btn-secondary" onclick="discoverOpenMaps('${c.id}')">Maps</button>
        </div>
      </div>
    </div>
  `;
}

async function discoverRefresh() {
  ensureDiscoverDefaults();
  const banner = document.getElementById('disc-ai-banner');
  if (banner) banner.style.display = 'flex';

  try {
    const placeType = DISCOVER_GOOGLE_TYPES.find(t => t.id === DiscoverState.placeType) || DISCOVER_GOOGLE_TYPES[0];
    const anchor = getDiscoveryAnchor();
    const places = await MapsService.searchPlaces({
      centerAddress: anchor,
      radiusMiles: Number(DiscoverState.radiusMiles),
      placeType
    });

    const enriched = await Promise.all(places.map(async (place, i) => {
      const coord = place.location || { lat: place.lat, lng: place.lng };
      const travel = await MapsService.chooseRoundTrip(anchor, coord);
      const visitMinutes = getEstimatedVisitDuration(placeType.id);
      return {
        ...place,
        id: place.placeId || `place-${Date.now()}-${i}`,
        type: placeType.id,
        typeLabel: placeType.label,
        visitMinutes,
        oneWayMinutes: travel?.oneWayMinutes || null,
        roundTripMinutes: travel?.roundTripMinutes || null,
        totalMinutes: travel ? travel.roundTripMinutes + visitMinutes : null,
        mode: travel?.mode || 'drive',
        miles: travel?.miles || null,
        lat: place.lat ?? coord.lat,
        lng: place.lng ?? coord.lng,
        why: `${placeType.label} within ${DiscoverState.radiusMiles} mi. Best option: ${travel?.mode || 'drive'}${travel ? `, ${travel.oneWayMinutes} min each way` : ''}.`
      };
    }));

    DiscoverState.cards = enriched.sort((a, b) => (a.totalMinutes || 9999) - (b.totalMinutes || 9999));
    DiscoverState.activeFilter = 'all';
    Store.setRecommendedPlaces(DiscoverState.cards);
    refreshDiscoverCards();
    if (document.getElementById('tab-today')?.classList.contains('active')) renderToday();
  } catch (err) {
    console.error('Discover Places error:', err);
    showToast(`Place search failed: ${err.message || 'try a different type or radius'}`);
  } finally {
    if (banner) banner.style.display = 'none';
  }
}

async function discoverSearch() {
  const input = document.getElementById('disc-q');
  if (!input?.value.trim()) return;
  const query = input.value.trim().toLowerCase();
  input.value = '';
  const custom = DISCOVER_GOOGLE_TYPES.find(t => query.includes(t.label.toLowerCase().split(' ')[0]));
  if (custom) DiscoverState.placeType = custom.id;
  await discoverRefresh();
}

function getEstimatedVisitDuration(type) {
  const durations = {
    snacks: 25,
    dining: 75,
    drinks: 55,
    'ice-cream': 25,
    thrift: 45,
    bookstores: 40,
    cafes: 45,
    museums: 90,
    sightseeing: 50,
    restaurant: 75,
    café: 45,
    bookstore: 40,
    park: 50
  };
  return durations[type] || 45;
}