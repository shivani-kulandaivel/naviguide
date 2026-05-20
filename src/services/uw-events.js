// Client for UW campus event feeds (API proxy or local seed fallback).
const UwEventsService = (() => {
  const API_PATHS = ['/api/uw-events', '/.netlify/functions/uw-events'];

  function todayIso() {
    return Store.getLocalTodayDateString?.() || Store.todayIsoLocal?.() || new Date().toISOString().split('T')[0];
  }

  function stampDates(events) {
    const today = todayIso();
    return (events || []).map(e => ({
      ...e,
      date: e.date || today
    }));
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

  async function fetchSeed() {
    try {
      const res = await fetch('src/data/uw-events-seed.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('seed missing');
      const events = await res.json();
      return stampDates(events);
    } catch (err) {
      console.warn('UW seed events failed:', err);
      return [];
    }
  }

  async function refreshCampusEvents() {
    const remote = await fetchFromApi();
    const events = remote?.length ? remote : await fetchSeed();
    if (!events.length) return { count: 0, source: 'none' };

    Store.mergeCalendarEvents(events, { replaceSource: 'uw' });
    return { count: events.length, source: remote?.length ? 'api' : 'seed' };
  }

  function filterEvents(events, filter) {
    if (!filter || filter === 'all') return events;
    if (filter === 'mine') {
      return events.filter(e => !e.source || e.source === 'user' || e.source === 'google' || e.source === 'ai');
    }
    if (filter === 'campus') {
      return events.filter(e => e.source === 'uw' || (e.tags || []).includes('campus'));
    }
    if (filter === 'dawg-daze') {
      return events.filter(e => (e.tags || []).includes('dawg-daze'));
    }
    return events;
  }

  function eventSourceLabel(e) {
    if ((e.tags || []).includes('dawg-daze')) return 'Dawg Daze';
    if (e.source === 'uw') return 'Campus';
    if (e.source === 'google') return 'Google';
    if (e.source === 'ai') return 'AI';
    if (e.source === 'social') return 'Social';
    return '';
  }

  const SOCIAL_LINKS = [
    { label: '#UWDawgDaze', url: 'https://www.instagram.com/explore/tags/uwdawgdaze/' },
    { label: '@uofwa', url: 'https://www.instagram.com/uofwa/' },
    { label: 'Dawg Daze events', url: 'https://dawgdaze.fyp.uw.edu/all-events/' },
    { label: 'UW campus calendar', url: 'https://www.trumba.com/events-calendar/wa/seattle/sea_campus' }
  ];

  return {
    refreshCampusEvents,
    filterEvents,
    eventSourceLabel,
    SOCIAL_LINKS
  };
})();

window.UwEventsService = UwEventsService;
