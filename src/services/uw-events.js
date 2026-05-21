// Client for UW campus event feeds (API proxy or local CSV fallback).
const UwEventsService = (() => {
  const API_PATHS = ['/api/uw-events', '/.netlify/functions/uw-events'];
  const CAMPUS_CSV_PATH = 'src/data/uw-events.csv';

  function todayIso() {
    return Store.getLocalTodayDateString?.() || Store.todayIsoLocal?.() || new Date().toISOString().split('T')[0];
  }

  function normalizeEventDate(dateStr) {
    if (!dateStr || !String(dateStr).trim()) return null;
    return String(dateStr).split('T')[0].slice(0, 10);
  }

  function stampDates(events) {
    return (events || [])
      .map(e => {
        const date = normalizeEventDate(e.date);
        if (!date) return null;
        return { ...e, date };
      })
      .filter(Boolean);
  }

  /** Parse RFC 4180-style CSV (quoted fields, escaped quotes). */
  function parseCsv(text) {
    const rows = [];
    const s = String(text || '').replace(/^\uFEFF/, '');
    let row = [];
    let cell = '';
    let i = 0;
    let inQuotes = false;

    while (i < s.length) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        cell += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ',') {
        row.push(cell);
        cell = '';
        i += 1;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i += 1;
        row.push(cell);
        cell = '';
        if (row.some(c => String(c).trim() !== '')) rows.push(row);
        row = [];
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
    }
    if (cell.length || row.length) {
      row.push(cell);
      if (row.some(c => String(c).trim() !== '')) rows.push(row);
    }
    return rows;
  }

  function slugPart(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
  }

  function inferDurationMinutes(time, title) {
    const t = String(time || '').trim();
    const lower = String(title || '').toLowerCase();
    if (!t || /^all\s*day$/i.test(t)) return 480;
    if (/recital|concert|ensemble|performance|playhouse|meany|sings/i.test(lower)) return 120;
    if (/exhibition|festival/i.test(lower)) return 240;
    if (/office hour|info session|seminar|lecture|roundtable|workshop/i.test(lower)) return 60;
    return 90;
  }

  function inferTags(title, location) {
    const text = `${title} ${location}`.toLowerCase();
    const tags = ['campus', 'uw-web'];
    if (/recital|concert|ensemble|sings|playhouse|performance/i.test(text)) tags.push('arts', 'performance');
    if (/exhibition|gallery/i.test(text)) tags.push('arts', 'exhibit');
    if (/seminar|lecture|research|symposium/i.test(text)) tags.push('academic', 'lecture');
    if (/study abroad|info session/i.test(text)) tags.push('academic');
    if (/festival|celebration|field day/i.test(text)) tags.push('social');
    if (/zoom/i.test(text)) tags.push('online');
    return tags;
  }

  function csvRowsToEvents(rows) {
    if (!rows.length) return [];
    const header = rows[0].map(h => String(h).trim().toLowerCase());
    const dateIdx = header.indexOf('date');
    const timeIdx = header.indexOf('time');
    const eventIdx = header.indexOf('event');
    const locIdx = header.indexOf('location');
    if (dateIdx < 0 || eventIdx < 0) return [];

    const events = [];
    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r];
      const date = normalizeEventDate(row[dateIdx]);
      const title = String(row[eventIdx] || '').trim();
      if (!date || !title) continue;

      const time = String(row[timeIdx] || 'All Day').trim() || 'All Day';
      const locRaw = String(row[locIdx] || '').trim();
      const loc = locRaw || 'University of Washington, Seattle';
      const externalId = `csv:${date}:${slugPart(time)}:${slugPart(title)}`;

      events.push({
        externalId,
        date,
        time,
        title,
        loc,
        url: 'https://calendar.washington.edu/',
        note: 'UW campus calendar export (May 22–27, 2026).',
        source: 'uw',
        tags: inferTags(title, loc),
        durationMinutes: inferDurationMinutes(time, title)
      });
    }
    return events;
  }

  async function fetchFromApi() {
    let lastErr = null;
    for (const path of API_PATHS) {
      try {
        const res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.events?.length) return stampDates(data.events);
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) console.warn('UW events API unavailable:', lastErr.message);
    return null;
  }

  async function fetchCampusCsv() {
    try {
      const res = await fetch(CAMPUS_CSV_PATH, { cache: 'no-store' });
      if (!res.ok) throw new Error('uw-events.csv missing');
      const text = await res.text();
      const events = csvRowsToEvents(parseCsv(text));
      return stampDates(events);
    } catch (err) {
      console.warn('UW campus CSV failed:', err);
      return [];
    }
  }

  async function refreshCampusEvents() {
    Store.removeSocialCalendarEvents?.();

    const csvEvents = await fetchCampusCsv();
    const remote = await fetchFromApi();
    // Prefer campus CSV; live Trumba RSS uses pubDate, not event start dates.
    const events = csvEvents.length ? csvEvents : (remote || []);
    if (!events.length) return { count: 0, source: 'none', uw: 0 };

    const uwEvents = events.filter(e => e.source === 'uw');

    if (uwEvents.length) Store.mergeCalendarEvents(uwEvents, { replaceSource: 'uw' });

    return {
      count: uwEvents.length,
      source: csvEvents.length ? 'csv' : (remote?.length ? 'live' : 'none'),
      uw: uwEvents.length
    };
  }

  function filterEvents(events, filter) {
    if (!filter || filter === 'all') return events;
    if (filter === 'mine') {
      return events.filter(e =>
        !e.source || e.source === 'user' || e.source === 'google' || e.source === 'ai'
      );
    }
    if (filter === 'uw-web') {
      return events.filter(e => e.source === 'uw');
    }
    if (filter === 'instagram') {
      return events.filter(e => e.source === 'instagram' || e.source === 'social');
    }
    if (filter === 'campus') {
      return events.filter(e =>
        e.source === 'uw' || e.source === 'instagram' || (e.tags || []).includes('campus')
      );
    }
    return events;
  }

  function eventSourceLabel(e) {
    if (e.source === 'instagram' || e.source === 'social') return 'Instagram';
    if (e.source === 'uw') return 'UW';
    if (e.source === 'google') return 'Google';
    if (e.source === 'ai') return 'AI';
    return '';
  }

  const SOCIAL_LINKS = [
    { label: '@uofwa', url: 'https://www.instagram.com/uofwa/' },
    { label: '@uwstudentlife', url: 'https://www.instagram.com/uwstudentlife/' },
    { label: '@uwdawgs', url: 'https://www.instagram.com/uwdawgs/' },
    { label: '#UWeekend', url: 'https://www.instagram.com/explore/tags/uweekend/' },
    { label: 'UW Calendar', url: 'https://calendar.washington.edu/' },
    { label: 'HUB events', url: 'https://hub.washington.edu/whats-happening/hub-events/' }
  ];

  return {
    refreshCampusEvents,
    filterEvents,
    eventSourceLabel,
    SOCIAL_LINKS
  };
})();

window.UwEventsService = UwEventsService;
