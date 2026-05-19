// Simple client-side storage layer for trips, calendar events, and API keys.
// Uses localStorage for persistence and provides helper methods for the app.
const Store = (() => {
  const STORAGE_KEY = 'wayfarer_trips';
  const CALENDAR_EVENTS_KEY = 'wayfarer_calendar_events';
  const DISCOVER_RECOMMENDED_KEY = 'wayfarer_discover_recommended_places';
  const API_KEY_KEY = 'wayfarer_api_key';
  const GOOGLE_API_KEY_KEY = 'wayfarer_google_api_key';
  const GOOGLE_CLIENT_ID_KEY = 'wayfarer_google_client_id';

  // Default trip history used when no saved trips exist in localStorage.
  const seedTrips = [
    { from: 'Home', to: 'Work', dur: 34, mode: 'Driving', purpose: 'Commute', date: daysAgo(1) },
    { from: 'Work', to: 'Gym', dur: 12, mode: 'Driving', purpose: 'Gym', date: daysAgo(1) },
    { from: 'Home', to: 'Work', dur: 38, mode: 'Driving', purpose: 'Commute', date: daysAgo(2) },
    { from: 'Work', to: 'Coffee', dur: 5, mode: 'Walking', purpose: 'Food', date: daysAgo(2) },
    { from: 'Home', to: 'Work', dur: 31, mode: 'Driving', purpose: 'Commute', date: daysAgo(3) },
    { from: 'Work', to: 'Gym', dur: 14, mode: 'Driving', purpose: 'Gym', date: daysAgo(3) },
    { from: 'Home', to: 'Grocery', dur: 9, mode: 'Driving', purpose: 'Errand', date: daysAgo(3) },
    { from: 'Home', to: 'Work', dur: 36, mode: 'Driving', purpose: 'Commute', date: daysAgo(4) },
    { from: 'Work', to: 'Coffee', dur: 4, mode: 'Walking', purpose: 'Food', date: daysAgo(4) },
    { from: 'Work', to: 'Gym', dur: 11, mode: 'Driving', purpose: 'Gym', date: daysAgo(5) },
  ];

  // Generate an ISO date string for N days ago.
  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }

  // Load saved trip history from localStorage, or fall back to seeded sample data.
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [...seedTrips];
    } catch { return [...seedTrips]; }
  }

  // Persist the trip array to localStorage.
  function save(trips) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trips)); } catch {}
  }

  // Retrieve the stored AI API key.
  function getApiKey() {
    return localStorage.getItem(API_KEY_KEY) || '';
  }

  // Store the AI API key in localStorage.
  function setApiKey(key) {
    localStorage.setItem(API_KEY_KEY, key);
  }

  // Retrieve the stored Google API key if used.
  function getGoogleApiKey() {
    return localStorage.getItem(GOOGLE_API_KEY_KEY) || '';
  }

  // Store the Google API key in localStorage.
  function setGoogleApiKey(key) {
    localStorage.setItem(GOOGLE_API_KEY_KEY, key);
  }

  // Retrieve the stored Google OAuth client ID.
  function getGoogleClientId() {
    return localStorage.getItem(GOOGLE_CLIENT_ID_KEY) || '';
  }

  // Store the Google OAuth client ID.
  function setGoogleClientId(id) {
    localStorage.setItem(GOOGLE_CLIENT_ID_KEY, id);
  }

  let trips = load();

  function todayIsoLocal() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
  }

  function seedCalendarEvents() {
    const date = todayIsoLocal();
    return [
      { date, time: '9:30 AM', title: 'INFO 200 lecture', loc: 'Mary Gates Hall, University of Washington, Seattle', type: 'class', depart: '9:15 AM', eta: '12 min' },
      { date, time: '11:00 AM', title: 'CSE 154 section', loc: 'Paul G Allen Center, University of Washington, Seattle', type: 'class', depart: '10:50 AM', eta: '8 min' },
      { date, time: '12:30 PM', title: 'Lunch with Sarah', loc: 'Capitol Hill, Seattle', depart: '12:20 PM', eta: '14 min' },
      { date, time: '2:00 PM', title: 'MATH 308 lecture', loc: 'Smith Hall, University of Washington, Seattle', type: 'class', depart: '1:45 PM', eta: '15 min' },
      { date, time: '4:00 PM', title: 'Office hours – Prof Lee', loc: 'Paul G Allen Center, University of Washington, Seattle', type: 'class', depart: '3:55 PM', eta: '5 min' },
      { date, time: '6:00 PM', title: 'Gym', loc: 'IMA, University of Washington, Seattle', depart: '5:47 PM', eta: '12 min' }
    ];
  }

  // Load calendar events from localStorage or provide example events if none exist.
  // Any stored event missing a date gets stamped with today so it still appears.
  // If the stored set has zero class events, append the seed classes so the map
  // always shows something representative of a UW day, and persist the merge.
  function loadCalendarEvents() {
    try {
      const raw = localStorage.getItem(CALENDAR_EVENTS_KEY);
      if (!raw) {
        const fresh = seedCalendarEvents();
        try { localStorage.setItem(CALENDAR_EVENTS_KEY, JSON.stringify(fresh)); } catch {}
        return fresh;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) {
        const fresh = seedCalendarEvents();
        try { localStorage.setItem(CALENDAR_EVENTS_KEY, JSON.stringify(fresh)); } catch {}
        return fresh;
      }
      const date = todayIsoLocal();
      const stamped = parsed.map(e => e?.date ? e : { ...e, date });
      const hasClass = stamped.some(e => e?.type === 'class');
      if (!hasClass) {
        const seedClasses = seedCalendarEvents().filter(e => e.type === 'class');
        const merged = [...seedClasses, ...stamped];
        try { localStorage.setItem(CALENDAR_EVENTS_KEY, JSON.stringify(merged)); } catch {}
        return merged;
      }
      return stamped;
    } catch {
      return seedCalendarEvents();
    }
  }

  // Normalize a date string or timestamp to YYYY-MM-DD only.
  // Split on 'T' directly to avoid UTC conversion shifting the date.
  function normalizeToDateOnly(d) {
    if (!d) return null;
    try { return d.split('T')[0].slice(0, 10) || null; } catch { return null; }
  }

  function getLocalTodayDateString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }

  // Check whether a date string is today or in the future.
  function isOnOrAfterToday(dateStr) {
    const d = normalizeToDateOnly(dateStr);
    if (!d) return false;
    const today = getLocalTodayDateString();
    return d >= today;
  }

  // Persist calendar events and drop past entries automatically.
  function saveCalendarEvents(events) {
    try {
      // persist only today and future events
      const filtered = (events || []).filter(e => isOnOrAfterToday(e.date));
      localStorage.setItem(CALENDAR_EVENTS_KEY, JSON.stringify(filtered));
    } catch {}
  }

  let calendarEvents = loadCalendarEvents();

  // Add a new trip to the top of the saved trip list.
  function addTrip(t) {
    t.date = new Date().toISOString().split('T')[0];
    trips.unshift(t);
    save(trips);
    return trips;
  }

  // Remove a trip from the saved history by index.
  function deleteTrip(i) {
    trips.splice(i, 1);
    save(trips);
    return trips;
  }

  // Return the current in-memory trips list.
  function getTrips() { return trips; }

  // Compute summary stats for the saved trips.
  function getStats() {
    if (!trips.length) return { count: 0, avgDur: 0, topDay: '—', topRoute: '—' };
    const avgDur = Math.round(trips.reduce((a, t) => a + t.dur, 0) / trips.length);
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dayCounts = {};
    trips.forEach(t => {
      const d = days[new Date(t.date).getDay()];
      dayCounts[d] = (dayCounts[d] || 0) + 1;
    });
    const topDay = Object.entries(dayCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';

    const routeCounts = {};
    trips.forEach(t => {
      const k = `${t.from} → ${t.to}`;
      routeCounts[k] = (routeCounts[k] || 0) + 1;
    });
    const topRoute = Object.entries(routeCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';

    return { count: trips.length, avgDur, topDay, topRoute };
  }

  // Aggregate the most frequent routes and compute average durations.
  function getFrequentRoutes() {
    const map = {};
    trips.forEach(t => {
      const k = `${t.from}|||${t.to}`;
      if (!map[k]) map[k] = { from: t.from, to: t.to, count: 0, durs: [], modes: {} };
      map[k].count++;
      map[k].durs.push(t.dur);
      map[k].modes[t.mode] = (map[k].modes[t.mode] || 0) + 1;
    });
    return Object.values(map)
      .sort((a,b) => b.count - a.count)
      .slice(0, 6)
      .map(r => ({
        ...r,
        avgDur: Math.round(r.durs.reduce((a,b) => a+b,0) / r.durs.length),
        topMode: Object.entries(r.modes).sort((a,b) => b[1]-a[1])[0]?.[0]
      }));
  }

  // Build a count of trips per day of week.
  function getDayBreakdown() {
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const counts = { Mon:0, Tue:0, Wed:0, Thu:0, Fri:0, Sat:0, Sun:0 };
    const dayMap = [6,0,1,2,3,4,5];
    trips.forEach(t => {
      const idx = dayMap[new Date(t.date).getDay()];
      counts[days[idx]]++;
    });
    return counts;
  }

  // Calculate mode share percentages for transport modes.
  function getModeBreakdown() {
    const modes = {};
    trips.forEach(t => { modes[t.mode] = (modes[t.mode] || 0) + 1; });
    const total = trips.length || 1;
    return Object.entries(modes)
      .sort((a,b) => b[1]-a[1])
      .map(([mode, count]) => ({ mode, pct: Math.round(count/total*100) }));
  }

  // Replace all stored calendar events with the provided list and persist them.
  // Only today's and future events are kept; past events are dropped automatically.
  // Class events from the current state are preserved across updates (so a
  // Google Calendar sync doesn't wipe your school schedule).
  function setCalendarEvents(events) {
    const items = Array.isArray(events) ? events : [];
    const incoming = items.filter(e => isOnOrAfterToday(e.date));
    const eventKey = e => `${e?.title || ''}|${e?.time || ''}|${e?.date || ''}`;
    const incomingKeys = new Set(incoming.map(eventKey));
    const preservedClasses = calendarEvents
      .filter(e => e?.type === 'class' && isOnOrAfterToday(e.date))
      .filter(c => !incomingKeys.has(eventKey(c)));
    // If even the existing list had no classes (e.g. brand-new user syncing fresh),
    // fall back to the seed classes so the map still has school stops.
    const classesToKeep = preservedClasses.length
      ? preservedClasses
      : (incoming.some(e => e?.type === 'class') ? [] : seedCalendarEvents().filter(e => e.type === 'class'));
    const merged = [...classesToKeep, ...incoming];
    calendarEvents.length = 0;
    merged.forEach(e => calendarEvents.push(e));
    saveCalendarEvents(calendarEvents);
  }

  function getRecommendedPlaces() {
    try {
      return JSON.parse(localStorage.getItem(DISCOVER_RECOMMENDED_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function setRecommendedPlaces(places) {
    try {
      localStorage.setItem(DISCOVER_RECOMMENDED_KEY, JSON.stringify((places || []).slice(0, 14)));
    } catch {}
  }

  return { addTrip, deleteTrip, getTrips, getStats, getFrequentRoutes, getDayBreakdown, getModeBreakdown, calendarEvents, setCalendarEvents, getRecommendedPlaces, setRecommendedPlaces, getApiKey, setApiKey, getGoogleApiKey, setGoogleApiKey, getGoogleClientId, setGoogleClientId };
})();