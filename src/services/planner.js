// Shared day-planning helpers for Today and Plan Trip tabs.
const Planner = (() => {
  const UW_GOLD_ROUTE = '#E8D9A8';

  function todayStr() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }

  function parseTimeToMinutes(timeStr) {
    if (!timeStr || timeStr === 'All Day') return null;
    const m = String(timeStr).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return null;
    let h = Number(m[1]);
    const mm = Number(m[2]);
    const ampm = (m[3] || '').toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + mm;
  }

  function minutesToTimeString(minutes) {
    const h24 = Math.floor(minutes / 60) % 24;
    const mm = minutes % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    let h = h24 % 12;
    if (h === 0) h = 12;
    return `${h}:${String(mm).padStart(2, '0')} ${ampm}`;
  }

  // Human-readable gap length: "45 min" under 60, else "1 hr 30 min".
  function formatDurationMinutes(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    if (m < 60) return `${m} min`;
    const hrs = Math.floor(m / 60);
    const mins = m % 60;
    const hrLabel = hrs === 1 ? '1 hr' : `${hrs} hr`;
    if (!mins) return hrLabel;
    return `${hrLabel} ${mins} min`;
  }

  function getEventLocation(event) {
    const location = event?.loc || event?.location || event?.place || '';
    return typeof location === 'string' ? location.trim() : '';
  }

  function getTodayEvents(events) {
    const today = todayStr();
    return (events || Store.calendarEvents || [])
      .filter(e => {
        const d = e?.date ? String(e.date).split('T')[0] : today;
        return d === today && e?.time && e.time !== 'All Day';
      })
      .sort((a, b) => (parseTimeToMinutes(a.time) || 0) - (parseTimeToMinutes(b.time) || 0));
  }

  function buildScheduleGaps(events, minVisitMinutes = 30) {
    const dayStart = 8 * 60;
    const dayEnd = 22 * 60;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    // Only consider gaps from "now + 5 min buffer" onwards, so the planner
    // never suggests slots that have already passed (or are too imminent to
    // realistically use).
    const earliest = Math.max(dayStart, nowMin + 5);
    const sorted = getTodayEvents(events);
    const gaps = [];
    let cursor = earliest;

    sorted.forEach(event => {
      const start = parseTimeToMinutes(event.time);
      if (start == null) return;
      const blockEnd = start + (Number(event.durationMinutes) || 30);
      // Skip events that ended before "now" — they can't open a future gap.
      if (blockEnd <= cursor) return;
      if (start - cursor >= minVisitMinutes) {
        gaps.push({
          startMinutes: cursor,
          endMinutes: start,
          duration: start - cursor,
          label: `${minutesToTimeString(cursor)} – ${minutesToTimeString(start)}`,
          badge: start - cursor >= 75 ? 'Spacious' : start - cursor >= 45 ? 'OK' : 'Tight'
        });
      }
      cursor = Math.max(cursor, blockEnd);
    });

    if (dayEnd - cursor >= minVisitMinutes) {
      gaps.push({
        startMinutes: cursor,
        endMinutes: dayEnd,
        duration: dayEnd - cursor,
        label: `${minutesToTimeString(cursor)} – ${minutesToTimeString(dayEnd)}`,
        badge: 'Spacious'
      });
    }
    return gaps;
  }

  async function estimateTravelMinutes(from, to) {
    if (!from?.lat || !to?.lat) return { minutes: 15, mode: 'walk' };
    const miles = haversineMiles(from, to);
    if (miles <= 0.75) {
      const walk = await MapsService.route(from, to, 'walking');
      if (walk?.minutes) return { minutes: walk.minutes, mode: 'walk' };
    }
    return { minutes: Math.max(12, Math.round(miles * 18)), mode: 'transit' };
  }

  function haversineMiles(from, to) {
    const R = 3958.8;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(to.lat - from.lat);
    const dLng = toRad(to.lng - from.lng);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function getNextMove(events) {
    const today = getTodayEvents(events);
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const upcoming = today.filter(e => (parseTimeToMinutes(e.time) || 0) >= nowMin - 5);
    const next = upcoming[0] || today.find(e => (parseTimeToMinutes(e.time) || 0) > nowMin);
    if (!next) return null;

    const eventMin = parseTimeToMinutes(next.time);
    const loc = getEventLocation(next);
    let travelMin = 12;
    let travelMode = 'walk';
    const prev = today.filter(e => (parseTimeToMinutes(e.time) || 0) < (eventMin || 0)).pop();
    if (prev && getEventLocation(prev) && loc) {
      try {
        const from = await MapsService.geocode(getEventLocation(prev));
        const to = await MapsService.geocode(loc);
        const est = await estimateTravelMinutes(
          { lat: from.lat, lng: from.lng },
          { lat: to.lat, lng: to.lng }
        );
        travelMin = est.minutes;
        travelMode = est.mode;
      } catch {}
    }

    const leaveBy = (eventMin || nowMin) - travelMin - 5;
    const buffer = leaveBy - nowMin;
    let status = 'On track';
    if (buffer < 0) status = 'Leave now';
    else if (buffer <= 8) status = 'Leave soon';
    else if (buffer <= 20) status = 'Plan ahead';

    return {
      event: next,
      leaveBy: minutesToTimeString(Math.max(0, leaveBy)),
      travelMin,
      travelMode,
      status,
      sources: ['Google Calendar', travelMode === 'walk' ? 'Walking estimate' : 'Transit estimate']
    };
  }

  async function buildRouteLegs(visitedStops) {
    if (!visitedStops || visitedStops.length < 2) return [];
    const legs = [];
    for (let i = 0; i < visitedStops.length - 1; i++) {
      const from = { lat: visitedStops[i].position[0], lng: visitedStops[i].position[1] };
      const to = { lat: visitedStops[i + 1].position[0], lng: visitedStops[i + 1].position[1] };
      const est = await estimateTravelMinutes(from, to);
      legs.push({
        from: visitedStops[i].label || visitedStops[i].event?.title,
        to: visitedStops[i + 1].label || visitedStops[i + 1].event?.title,
        minutes: est.minutes,
        mode: est.mode
      });
    }
    return legs;
  }

  function filterRecommendations(places) {
    const dismissed = new Set(Store.getDismissedRecIds?.() || []);
    return (places || []).filter(p => !dismissed.has(p.id || p.placeId));
  }

  function rankRecsForGaps(recs, gaps) {
    if (!gaps.length) return recs.slice(0, 3);
    const gap = gaps.find(g => g.duration >= 35) || gaps[0];
    return recs
      .filter(r => (r.visitMinutes || 30) <= gap.duration)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 3)
      .map(r => ({ ...r, gapLabel: gap.label, gapMinutes: gap.duration }));
  }

  return {
    UW_GOLD_ROUTE,
    todayStr,
    parseTimeToMinutes,
    minutesToTimeString,
    formatDurationMinutes,
    getEventLocation,
    getTodayEvents,
    buildScheduleGaps,
    getNextMove,
    buildRouteLegs,
    estimateTravelMinutes,
    filterRecommendations,
    rankRecsForGaps
  };
})();
