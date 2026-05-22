// UW Events tab — campus events from uw-events.csv

const UwEventsTabState = {
  cards: [],
  loaded: false,
  loading: false,
  activeDayFilter: 'all',
};

const UW_EVENT_COLOR = '#4B2E83';
const UW_EVENT_EMOJI = '🎓';

function getLocalDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

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

function getUwEventCard(id) {
  return UwEventsTabState.cards.find(c => c.id === id);
}

function showUwEventsToast(msg) {
  const t = document.createElement('div');
  t.className = 'disc-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('visible'));
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 400); }, 2800);
}

async function tryCreateGoogleEventWithAuth(resource, timeout = 15000) {
  if (typeof window.createGoogleCalendarEvent !== 'function') return null;
  try {
    const res = await window.createGoogleCalendarEvent(resource);
    if (res) return res;
  } catch (e) {
    console.warn('Initial Google create failed', e);
  }
  if (typeof window.loadGoogleCalendar === 'function') {
    try { window.loadGoogleCalendar(); } catch (e) { console.warn('loadGoogleCalendar failed', e); }
  }
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const res2 = await window.createGoogleCalendarEvent(resource);
      if (res2) return res2;
    } catch {}
  }
  return null;
}

function renderUwEvents() {
  const pane = document.getElementById('tab-uw-events');
  if (!pane) return;

  const dayFilters = ['all', ...new Set(UwEventsTabState.cards.map(c => c.day).filter(Boolean))];

  pane.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-eyebrow">CAMPUS</div>
        <div class="page-title">UW Events</div>
        <div class="page-sub">Upcoming happenings with dates and times from the UW calendar feed</div>
      </div>
      <button type="button" class="chip" onclick="uwEventsReload()">↺ Refresh</button>
    </div>

    <div class="uw-events-filters" id="uw-events-filters">
      ${dayFilters.map(d => `
        <button type="button" class="disc-filter-chip ${UwEventsTabState.activeDayFilter === d ? 'active' : ''}"
          onclick="uwEventsSetDayFilter('${d}')">${d === 'all' ? '✦ All days' : d}</button>
      `).join('')}
    </div>

    <div class="disc-grid uw-events-grid" id="uw-events-grid">
      ${buildUwEventsTabGrid()}
    </div>

    <div id="uw-events-modal-root"></div>
  `;

  if (!UwEventsTabState.loaded && !UwEventsTabState.loading) {
    loadUwEventsTab();
  }
}

async function loadUwEventsTab() {
  if (typeof UwEventsService?.ensureLoaded !== 'function') return;
  UwEventsTabState.loading = true;
  refreshUwEventsGrid();
  try {
    await UwEventsService.ensureLoaded();
    UwEventsTabState.cards = UwEventsService.getUpcoming({ limit: 48 })
      .map(e => UwEventsService.toDiscoverCard(e));
    UwEventsTabState.loaded = true;
  } catch (err) {
    console.warn('[uw-events] load failed', err);
  } finally {
    UwEventsTabState.loading = false;
    const pane = document.getElementById('tab-uw-events');
    if (pane?.classList.contains('active')) renderUwEvents();
    else refreshUwEventsGrid();
  }
}

function uwEventsReload() {
  UwEventsTabState.loaded = false;
  UwEventsTabState.cards = [];
  loadUwEventsTab();
}

function uwEventsSetDayFilter(day) {
  UwEventsTabState.activeDayFilter = day;
  const pane = document.getElementById('tab-uw-events');
  if (pane?.classList.contains('active')) renderUwEvents();
  else refreshUwEventsGrid();
}

function refreshUwEventsGrid() {
  const grid = document.getElementById('uw-events-grid');
  const filters = document.getElementById('uw-events-filters');
  if (grid) grid.innerHTML = buildUwEventsTabGrid();
  if (filters && UwEventsTabState.loaded) {
    const dayFilters = ['all', ...new Set(UwEventsTabState.cards.map(c => c.day).filter(Boolean))];
    filters.innerHTML = dayFilters.map(d => `
      <button type="button" class="disc-filter-chip ${UwEventsTabState.activeDayFilter === d ? 'active' : ''}"
        onclick="uwEventsSetDayFilter('${d}')">${d === 'all' ? '✦ All days' : d}</button>
    `).join('');
  }
}

function buildUwEventsTabGrid() {
  if (UwEventsTabState.loading) {
    return '<div class="empty" style="grid-column:1/-1;padding:40px 0">Loading UW events…</div>';
  }
  let cards = UwEventsTabState.cards || [];
  if (UwEventsTabState.activeDayFilter !== 'all') {
    cards = cards.filter(c => c.day === UwEventsTabState.activeDayFilter);
  }
  if (!cards.length) {
    return '<div class="empty" style="grid-column:1/-1;padding:40px 0">No upcoming events to show.</div>';
  }
  return cards.map(c => buildUwEventCard(c)).join('');
}

function buildUwEventCard(c) {
  const dateShort = c.eventDate
    ? c.eventDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${Number(m)}/${Number(d)}`)
    : '';

  return `
    <div class="disc-card disc-card-uw-event" id="uw-card-${c.id}">
      <div class="disc-card-img" style="background:linear-gradient(135deg, ${UW_EVENT_COLOR}18, #ffffff 72%)">
        <div class="disc-rec-ribbon disc-rec-ribbon-event">UW Event</div>
        <div class="disc-map-art" style="--card-color:${UW_EVENT_COLOR}">
          <div class="disc-map-grid"></div>
          <div class="disc-map-marker">
            <div class="disc-map-marker-dot" style="background:${UW_EVENT_COLOR}"></div>
            <div class="disc-map-marker-ring" style="border-color:${UW_EVENT_COLOR}40"></div>
          </div>
          <div class="disc-map-label">${c.vicinity || 'Campus'}</div>
        </div>
        <div class="disc-card-type-badge disc-card-kind-badge" style="background:${UW_EVENT_COLOR}22;color:${UW_EVENT_COLOR};border-color:${UW_EVENT_COLOR}33">${UW_EVENT_EMOJI} UW Event</div>
        ${c.addedTo ? `<div class="disc-card-added-badge">Added</div>` : ''}
      </div>

      <div class="disc-card-body">
        <div class="disc-card-name-row">
          <div class="disc-card-name">${c.name}</div>
        </div>
        <div class="disc-card-address">${c.address}</div>
        ${c.summary ? `<div class="disc-card-summary">${c.summary}</div>` : ''}
        <div class="disc-card-why" style="color:${UW_EVENT_COLOR}">${c.why}</div>
        <div class="disc-time-stack disc-event-time-stack">
          <span>${dateShort || 'Upcoming'}</span>
          <span>${c.isAllDay ? 'All day' : c.time}</span>
          <span>${c.durationMinutes || 90} min</span>
          <strong>${c.day}</strong>
        </div>

        <div class="disc-card-actions">
          <button type="button" class="disc-card-btn-primary" onclick="uwEventsAddToSchedule('${c.id}')">
            ${c.addedTo ? 'Scheduled' : '+ Add to calendar'}
          </button>
          <button type="button" class="disc-card-btn-secondary" onclick="uwEventsOpenMaps('${c.id}')">Maps</button>
        </div>
      </div>
    </div>
  `;
}

function uwEventsOpenMaps(id) {
  const card = getUwEventCard(id);
  if (!card) return;
  window.open(`https://www.google.com/maps/search/${encodeURIComponent(card.name + ' ' + card.address)}`, '_blank');
}

function uwEventsAddToSchedule(id) {
  const card = getUwEventCard(id);
  if (!card) return;
  const root = document.getElementById('uw-events-modal-root');
  if (!root) return;
  const when = card.isAllDay ? `${card.day} · All day` : `${card.time} · ${card.day}`;
  const dateLabel = card.eventDate || getLocalDateString();

  root.innerHTML = `
    <div class="disc-modal-overlay" onclick="uwEventsCloseModal()">
      <div class="disc-modal" onclick="event.stopPropagation()">
        <div class="disc-modal-header" style="border-color:${UW_EVENT_COLOR}33">
          <div class="disc-modal-icon" style="background:${UW_EVENT_COLOR}22;border-color:${UW_EVENT_COLOR}33">${UW_EVENT_EMOJI}</div>
          <div>
            <div class="disc-modal-title">${card.name}</div>
            <div class="disc-modal-sub">${card.address}</div>
          </div>
          <button type="button" class="disc-modal-close" onclick="uwEventsCloseModal()">✕</button>
        </div>
        <div class="disc-modal-body">
          <div class="disc-modal-label">Event time</div>
          <div class="disc-modal-sub" style="margin-bottom:12px">${when} · ${dateLabel}</div>
          <div class="disc-modal-sub" style="margin-bottom:16px">Estimated ${card.durationMinutes || 90} min</div>
          <button type="button" class="btn-primary" style="width:100%" onclick="uwEventsConfirmAdd('${card.id}')">
            Add to calendar at event time
          </button>
        </div>
      </div>
    </div>
  `;
}

function uwEventsCloseModal() {
  const root = document.getElementById('uw-events-modal-root');
  if (root) root.innerHTML = '';
}

async function uwEventsConfirmAdd(cardId) {
  const card = getUwEventCard(cardId);
  if (!card) return;

  const newEvent = {
    date: card.eventDate || getLocalDateString(),
    time: card.time || 'All Day',
    title: card.name,
    loc: card.address,
    location: card.address,
    note: `UW Event · ${card.day}`,
    durationMinutes: card.durationMinutes || 90,
    uwEvent: true,
  };

  if (typeof window.createGoogleCalendarEvent === 'function' && card.time && card.time !== 'All Day') {
    const eventDateTime = window.buildGoogleEventDateTime(newEvent.time, newEvent.durationMinutes);
    const resource = {
      summary: newEvent.title,
      location: newEvent.loc,
      description: newEvent.note,
      start: eventDateTime.start,
      end: eventDateTime.end,
    };
    try {
      const result = await tryCreateGoogleEventWithAuth(resource);
      if (result?.id) newEvent.googleId = result.id;
      if (result?.start?.dateTime || result?.start?.date) {
        newEvent.date = result.start.dateTime || result.start.date;
      }
    } catch (err) {
      console.warn('Google event create failed', err);
    }
  }

  if (typeof Store.addCalendarEvents === 'function') {
    Store.addCalendarEvents([newEvent]);
  } else {
    Store.calendarEvents.push(newEvent);
    Store.calendarEvents.sort((a, b) => (timeStringToMinutes(a.time) ?? 9999) - (timeStringToMinutes(b.time) ?? 9999));
    Store.setCalendarEvents(Store.calendarEvents);
  }

  card.addedTo = card.time || 'Scheduled';
  uwEventsCloseModal();
  refreshUwEventsGrid();
  if (document.getElementById('tab-today')?.classList.contains('active') && typeof renderToday === 'function') {
    renderToday();
  }
  showUwEventsToast(`${card.name} added to your calendar!`);
}

window.renderUwEvents = renderUwEvents;
window.uwEventsReload = uwEventsReload;
window.uwEventsSetDayFilter = uwEventsSetDayFilter;
window.uwEventsAddToSchedule = uwEventsAddToSchedule;
window.uwEventsOpenMaps = uwEventsOpenMaps;
window.uwEventsCloseModal = uwEventsCloseModal;
window.uwEventsConfirmAdd = uwEventsConfirmAdd;
