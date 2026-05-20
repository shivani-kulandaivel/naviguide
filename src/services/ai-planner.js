// Natural-language day planning via Gemini JSON responses.
const AiPlanner = (() => {
  const PLANNER_SCHEMA = `Respond with ONLY valid JSON (no markdown):
{
  "intent": "add_event" | "answer_only",
  "message": "short user-facing text",
  "events": [{ "title": "string", "date": "YYYY-MM-DD", "time": "H:MM AM/PM", "loc": "string or null", "durationMinutes": number, "note": "string or null" }]
}`;

  function todayIso() {
    return Store.getLocalTodayDateString?.() || new Date().toISOString().split('T')[0];
  }

  function parseJsonFromText(text) {
    const raw = String(text || '').trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;
    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
      throw new Error('Could not parse AI response');
    }
  }

  async function planDayFromText(userText) {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      return { intent: 'answer_only', message: 'Add your Gemini API key in the sidebar to use Add to my day.', events: [] };
    }

    const today = todayIso();
    const systemPrompt = typeof buildSystemPrompt === 'function'
      ? buildSystemPrompt()
      : 'You are NaviGuide for UW Seattle students.';

    const prompt = `Today is ${today} (Pacific). User request: "${userText}"

If they want to schedule something, set intent to add_event and fill events (default date to today if unspecified; resolve "tomorrow", weekday names). Use UW campus locations when vague ("on campus" → HUB, UW Seattle). Default durationMinutes to 60 for meetings, 45 for coffee.

If they only ask a question, set intent to answer_only and leave events empty.

${PLANNER_SCHEMA}`;

    const text = await askGeminiFlash(prompt, systemPrompt, 600, { json: true });
    const parsed = parseJsonFromText(text);
    const events = (parsed.events || []).map(e => ({
      title: e.title || 'New event',
      date: e.date || today,
      time: e.time || '12:00 PM',
      loc: e.loc || null,
      durationMinutes: Number(e.durationMinutes) || 60,
      note: e.note || null,
      source: 'ai',
      tags: ['ai']
    }));

    return {
      intent: parsed.intent === 'add_event' && events.length ? 'add_event' : 'answer_only',
      message: parsed.message || (events.length ? 'Ready to add to your calendar.' : 'Here is what I found.'),
      events
    };
  }

  async function confirmPlannedEvents(events) {
    const added = [];
    for (const ev of events || []) {
      const newEvent = {
        date: ev.date,
        time: ev.time,
        title: ev.title,
        loc: ev.loc,
        note: ev.note,
        source: 'ai',
        tags: ['ai'],
        durationMinutes: ev.durationMinutes
      };

      if (typeof window.createGoogleCalendarEvent === 'function' && typeof window.buildGoogleEventDateTime === 'function') {
        const eventDateTime = window.buildGoogleEventDateTime(newEvent.time, newEvent.durationMinutes || 60);
        const resource = {
          summary: newEvent.title,
          location: newEvent.loc || '',
          description: newEvent.note || '',
          start: eventDateTime.start,
          end: eventDateTime.end
        };
        try {
          const result = await window.createGoogleCalendarEvent(resource);
          if (result?.id) newEvent.googleId = result.id;
        } catch (err) {
          console.warn('Google create skipped', err);
        }
      }

      Store.addCalendarEvent(newEvent);
      added.push(newEvent);
    }

    if (typeof renderToday === 'function') renderToday();
    return added;
  }

  const GAP_CACHE_KEY = 'naviguide_gap_suggestion';

  async function getGapSuggestionIfNeeded() {
    const today = todayIso();
    try {
      const cached = JSON.parse(localStorage.getItem(GAP_CACHE_KEY) || 'null');
      if (cached?.date === today && cached?.text) return cached.text;
    } catch {}

    if (typeof getTodayEvents !== 'function' || typeof buildScheduleGaps !== 'function') return null;
    const todayEvents = getTodayEvents();
    const gaps = buildScheduleGaps(todayEvents, 45).filter(g => g.duration >= 60);
    if (!gaps.length) return null;

    const apiKey = await getGeminiApiKey();
    if (!apiKey) return null;

    const gap = gaps[0];
    const eventsSummary = Store.calendarEvents
      .filter(e => (e.date || '').split('T')[0] === today)
      .map(e => `${e.time} ${e.title}`)
      .join('; ');

    const prompt = `Free window: ${gap.label} (${gap.duration} min). Calendar: ${eventsSummary}. Suggest ONE short UW campus activity (under 15 words) the student could add. Plain text only, no quotes.`;
    try {
      const text = await askGeminiFlash(prompt, buildSystemPrompt(), 80);
      const suggestion = text.split('\n')[0].trim();
      if (suggestion) {
        localStorage.setItem(GAP_CACHE_KEY, JSON.stringify({ date: today, text: suggestion }));
        return suggestion;
      }
    } catch {}
    return null;
  }

  return { planDayFromText, confirmPlannedEvents, getGapSuggestionIfNeeded };
})();

window.AiPlanner = AiPlanner;
