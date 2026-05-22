// UW campus events from uw-events.csv — shared by Discover and Auto-plan.
const UwEventsService = (() => {
  const CSV_URL = 'uw-events.csv';
  const UW_EVENT_COLOR = '#4B2E83';
  const DEFAULT_DURATION = 90;

  let events = [];
  let loadPromise = null;

  function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function parseTimeToMinutes(timeStr) {
    const t = String(timeStr || '').trim();
    if (!t || /^all\s*day$/i.test(t)) return null;
    const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let h = Number(m[1]);
    const mm = Number(m[2]);
    const ap = (m[3] || '').toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + mm;
  }

  function minutesToTimeString(minutes) {
    if (minutes == null) return 'All Day';
    const h24 = Math.floor(minutes / 60) % 24;
    const mm = minutes % 60;
    const ap = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 || 12;
    return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
  }

  function slugId(parts) {
    return String(parts.join('-')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  }

  function parseCsv(text) {
    const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 5) continue;
      const [date, day, time, title, location] = cols;
      const timeMinutes = parseTimeToMinutes(time);
      const isAllDay = /^all\s*day$/i.test(String(time || '').trim());
      const id = `uw-${slugId([date, time, title])}`;
      parsed.push({
        id,
        date,
        day,
        time: isAllDay ? 'All Day' : time,
        timeMinutes,
        isAllDay,
        title: title.trim(),
        location: location.trim(),
        durationMinutes: isAllDay ? 120 : DEFAULT_DURATION,
      });
    }
    return parsed;
  }

  async function load() {
    if (events.length) return events;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const res = await fetch(CSV_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not load ${CSV_URL}`);
      const text = await res.text();
      events = parseCsv(text);
      return events;
    })();
    return loadPromise;
  }

  async function ensureLoaded() {
    try {
      return await load();
    } catch (err) {
      console.warn('[uw-events] load failed', err);
      return [];
    }
  }

  function todayStr() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }

  function isUpcoming(event) {
    const today = todayStr();
    if (event.date < today) return false;
    if (event.date > today) return true;
    if (event.isAllDay) return true;
    if (event.timeMinutes == null) return true;
    const now = new Date().getHours() * 60 + new Date().getMinutes();
    return event.timeMinutes >= now - 15;
  }

  function getUpcoming({ limit = 24 } = {}) {
    return events
      .filter(isUpcoming)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.timeMinutes ?? 0) - (b.timeMinutes ?? 0);
      })
      .slice(0, limit);
  }

  function shortVicinity(location) {
    const loc = String(location || '');
    const paren = loc.match(/\(([^)]+)\)\s*$/);
    if (paren) return paren[1];
    const pipe = loc.split('|')[0]?.trim();
    return (pipe || loc).split(',')[0].slice(0, 42);
  }

  function toDiscoverCard(event) {
    const when = event.isAllDay
      ? `${event.day} · All day`
      : `${event.day} · ${event.time}`;
    return {
      id: event.id,
      cardKind: 'uw-event',
      type: 'uw-event',
      typeLabel: 'UW Event',
      name: event.title,
      address: event.location,
      vicinity: shortVicinity(event.location),
      eventDate: event.date,
      day: event.day,
      time: event.time,
      timeMinutes: event.timeMinutes,
      isAllDay: event.isAllDay,
      durationMinutes: event.durationMinutes,
      why: when,
      summary: `Campus event at ${shortVicinity(event.location)}.`,
      visitMinutes: event.durationMinutes,
      addedTo: null,
      uwEvent: event,
    };
  }

  function scoreForSocial(event, query) {
    const q = String(query || '').toLowerCase();
    const hay = `${event.title} ${event.location}`.toLowerCase();
    let score = 1;
    if (/festival|community|celebration|social|party|recital|performance|fair|hang|meet|workshop|lecture|seminar|concert|sings|ensemble/i.test(hay)) score += 3;
    if (/zoom|online store|info session/i.test(hay) && !/in person|in-person/i.test(hay)) score -= 2;
    if (/friend|hang|meet|social|group/.test(q) && /festival|community|celebration|community day|roundtable/i.test(hay)) score += 4;
    if (event.timeMinutes != null && event.timeMinutes >= 17 * 60) score += 1;
    if (event.day === 'Friday' || event.day === 'Saturday') score += 1;
    return score;
  }

  function recommendForSocial(query, { excludeIds = [], limit = 3, gaps = [] } = {}) {
    const exclude = new Set(excludeIds);
    const pool = getUpcoming({ limit: 48 }).filter(e => !exclude.has(e.id));
    const ranked = pool
      .map(e => ({ event: e, score: scoreForSocial(e, query) }))
      .sort((a, b) => b.score - a.score || (a.event.date + (a.event.timeMinutes ?? 0)) - (b.event.date + (b.event.timeMinutes ?? 0)));
    return ranked.slice(0, limit).map(r => r.event);
  }

  function gapForEvent(event, gaps) {
    if (!gaps?.length) {
      const start = event.isAllDay ? 12 * 60 : (event.timeMinutes ?? 12 * 60);
      return {
        startMinutes: start,
        endMinutes: start + (event.durationMinutes || DEFAULT_DURATION),
        duration: event.durationMinutes || DEFAULT_DURATION,
        label: event.isAllDay ? `${event.day} · All day` : `${event.time}`,
        badge: 'OK',
      };
    }
    const eventDay = event.date;
    const today = todayStr();
    const match = gaps.find(g => {
      if (eventDay !== today) return false;
      if (event.isAllDay) return g.duration >= 60;
      if (event.timeMinutes == null) return true;
      return event.timeMinutes >= g.startMinutes && event.timeMinutes + 30 <= g.endMinutes;
    });
    if (match && event.timeMinutes != null) {
      return {
        ...match,
        startMinutes: event.timeMinutes,
        duration: Math.min(event.durationMinutes || DEFAULT_DURATION, match.endMinutes - event.timeMinutes),
        label: `${event.time} · ${event.day}`,
      };
    }
    return gaps[0];
  }

  function isSocialMeetupQuery(text) {
    return /\b(meet friends|hang out|hangout|with friends|meet up|meetup|see friends|grab friends|something to do|what'?s happening|campus events?|uw events?|go to an event|attend an event|social plan|plans with friends)\b/i.test(String(text || ''));
  }

  return {
    load,
    ensureLoaded,
    getUpcoming,
    toDiscoverCard,
    recommendForSocial,
    gapForEvent,
    isSocialMeetupQuery,
    parseTimeToMinutes,
    minutesToTimeString,
    UW_EVENT_COLOR,
  };
})();

window.UwEventsService = UwEventsService;
