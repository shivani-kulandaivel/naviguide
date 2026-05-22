// Auto-plan tab — conversational AI that fills the user's free time.
// User describes what they want to do outside of their planned schedule;
// Gemini Flash picks categories + gaps, we resolve them to real OSM places,
// and clicking "Add" writes events to Google Calendar (or local storage).

const AutoPlanState = {
  messages: [],          // [{ role: 'user'|'ai', html: string }]
  suggestionCards: [],   // live cards — re-rendered on each action (not frozen in message HTML)
  pendingCards: {},      // id -> enriched suggestion (legacy lookup for handlers)
  lastUserQuery: '',     // last chat prompt — used to fetch another spot on Skip
  thinking: false,
  greeted: false,
};

let autoPlanPaneClickBound = false;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

function getAutoPlanCard(cardId) {
  return AutoPlanState.suggestionCards.find(c => c.id === cardId)
    || AutoPlanState.pendingCards[cardId];
}

function ensureAutoPlanPaneActions() {
  const pane = document.getElementById('tab-autoplan');
  if (!pane || autoPlanPaneClickBound) return;
  autoPlanPaneClickBound = true;

  pane.addEventListener('click', (e) => {
    const resetBtn = e.target.closest('[data-autoplan-reset]');
    if (resetBtn) {
      e.preventDefault();
      autoPlanReset();
      return;
    }

    const sendBtn = e.target.closest('[data-autoplan-send]');
    if (sendBtn) {
      e.preventDefault();
      if (!AutoPlanState.thinking) autoPlanSend();
      return;
    }

    const quickBtn = e.target.closest('[data-autoplan-quick]');
    if (quickBtn) {
      e.preventDefault();
      autoPlanQuickPrompt(quickBtn.getAttribute('data-autoplan-quick') || '');
      return;
    }

    const addBtn = e.target.closest('[data-autoplan-add]');
    if (addBtn) {
      e.preventDefault();
      autoPlanAddToSchedule(addBtn.getAttribute('data-autoplan-add') || '');
      return;
    }

    const dismissBtn = e.target.closest('[data-autoplan-dismiss]');
    if (dismissBtn) {
      e.preventDefault();
      const id = dismissBtn.getAttribute('data-autoplan-dismiss') || '';
      dismissBtn.disabled = true;
      dismissBtn.textContent = 'Finding…';
      autoPlanDismiss(id);
      return;
    }

    const undoBtn = e.target.closest('[data-autoplan-undo]');
    if (undoBtn) {
      e.preventDefault();
      autoPlanUndo(undoBtn.getAttribute('data-autoplan-undo') || '');
    }
  });

  pane.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target?.id === 'autoplan-input' && !AutoPlanState.thinking) {
      e.preventDefault();
      autoPlanSend();
    }
  });
}

// Place categories the planner can search for. Backed by the same Overpass
// filters Discover/Today use, so results are consistent across tabs.
const AUTOPLAN_CATEGORIES = [
  { id: 'cafes',       label: 'Cafe',       visitMinutes: 35, osmFilters: ['amenity=cafe'] },
  { id: 'dining',      label: 'Restaurant', visitMinutes: 60, osmFilters: ['amenity=restaurant'] },
  { id: 'museums',     label: 'Museum',     visitMinutes: 90, osmFilters: ['tourism=museum', 'tourism=gallery'] },
  { id: 'sightseeing', label: 'Sightseeing',visitMinutes: 45, osmFilters: ['tourism=attraction', 'tourism=viewpoint'] },
  { id: 'bookstores',  label: 'Bookstore',  visitMinutes: 30, osmFilters: ['shop=books'] },
  { id: 'ice-cream',   label: 'Ice cream',  visitMinutes: 25, osmFilters: ['amenity=ice_cream', 'shop=ice_cream'] },
  { id: 'park',        label: 'Park',       visitMinutes: 30, osmFilters: ['leisure=park'] },
  { id: 'gym',         label: 'Gym',        visitMinutes: 60, osmFilters: ['leisure=fitness_centre', 'leisure=sports_centre'] },
  { id: 'grocery',     label: 'Grocery',    visitMinutes: 30, osmFilters: ['shop=supermarket', 'shop=convenience'] },
];

const DISCOVER_CATEGORY_IDS = new Set(
  (typeof window !== 'undefined' && window.DISCOVER_PLACE_TYPES
    ? window.DISCOVER_PLACE_TYPES
    : [{ id: 'cafes' }, { id: 'dining' }, { id: 'bookstores' }, { id: 'museums' }, { id: 'sightseeing' }, { id: 'ice-cream' }, { id: 'snacks' }, { id: 'drinks' }, { id: 'thrift' }]
  ).map(t => t.id)
);

function normalizeAutoplanCategory(categoryId, userText = '') {
  const id = String(categoryId || '').toLowerCase().trim();
  const aliases = {
    'bubble-tea': 'cafes',
    boba: 'cafes',
    cafe: 'cafes',
    coffee: 'cafes',
    restaurant: 'dining',
    food: 'dining',
    bookstore: 'bookstores',
    museum: 'museums',
    park: 'sightseeing',
  };
  if (aliases[id]) return aliases[id];
  if (AUTOPLAN_CATEGORIES.some(c => c.id === id)) return id;
  if (typeof window.resolveDiscoverCategoryFromQuery === 'function') {
    const resolved = window.resolveDiscoverCategoryFromQuery(userText || id).placeType;
    if (resolved?.id) return resolved.id;
  }
  return 'cafes';
}

const AUTOPLAN_QUICK_PROMPTS = [
  'Grab boba and a place to study',
  'Find me a quick lunch',
  'Something fun after my last class',
  'A cafe to grind in for an hour',
  'A scenic walk somewhere on campus',
];

// ── Rendering ────────────────────────────────────────────────────────────────
function renderAutoPlan() {
  const pane = document.getElementById('tab-autoplan');
  if (!pane) return;

  const gaps = Planner.buildScheduleGaps(Store.calendarEvents);

  if (!AutoPlanState.greeted) {
    AutoPlanState.messages.push({ role: 'ai', html: buildAutoPlanGreeting(gaps) });
    AutoPlanState.greeted = true;
  }

  pane.innerHTML = `
    <div class="page-header today-header">
      <div>
        <div class="page-eyebrow">AI ASSISTANT</div>
        <div class="page-title">Auto-plan</div>
        <div class="page-sub">Tell me what you want to add to your day — I'll find real spots and slot them in.</div>
      </div>
      <button type="button" class="chip" data-autoplan-reset title="Clear chat">↺ Reset</button>
    </div>

    <div class="autoplan-context">
      ${buildAutoPlanContext(gaps)}
    </div>

    <div class="autoplan-chat" id="autoplan-chat">
      ${AutoPlanState.messages.map(renderChatMsg).join('')}
    </div>

    ${AutoPlanState.suggestionCards.length
      ? `<div class="autoplan-suggestions" id="autoplan-suggestions">${renderSuggestionCards(AutoPlanState.suggestionCards)}</div>`
      : ''}

    <div class="autoplan-quick-prompts">
      ${AUTOPLAN_QUICK_PROMPTS.map(p => `<button type="button" class="chip" data-autoplan-quick="${escapeAttr(p)}">${escapeHtml(p)}</button>`).join('')}
    </div>

    <div class="autoplan-input-row">
      <input type="text" id="autoplan-input" class="autoplan-input" placeholder="e.g. boba + a quick bookstore visit" autocomplete="off" />
      <button type="button" class="btn-primary autoplan-send-btn" data-autoplan-send ${AutoPlanState.thinking ? 'disabled' : ''}>
        ${AutoPlanState.thinking ? 'Thinking…' : 'Send'}
      </button>
    </div>
  `;

  ensureAutoPlanPaneActions();

  // Auto-scroll the chat to the newest message.
  requestAnimationFrame(() => {
    const chat = document.getElementById('autoplan-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
    const input = document.getElementById('autoplan-input');
    if (input && !AutoPlanState.thinking) input.focus();
  });
}

function buildAutoPlanGreeting(gaps) {
  if (!gaps.length) {
    return `Hey! Your day is already packed — but drop what you'd want to add and I'll see if I can squeeze it in.`;
  }
  const top = gaps.slice(0, 3).map(g => `<strong>${escapeHtml(g.label)}</strong> (${g.duration} min)`).join(', ');
  return `Hey! Here are the open windows I see today: ${top}.<br><br>What do you want to do outside of your existing plans?`;
}

function buildAutoPlanContext(gaps) {
  if (!gaps.length) {
    return `<div class="autoplan-context-empty">No free gaps detected today.</div>`;
  }
  return `
    <div class="autoplan-context-label">Open windows</div>
    <div class="autoplan-context-pills">
      ${gaps.map((g, i) => `
        <div class="autoplan-context-pill is-${g.badge.toLowerCase()}">
          <span class="autoplan-context-pill-time">${escapeHtml(g.label)}</span>
          <span class="autoplan-context-pill-dur">${g.duration} min · ${escapeHtml(g.badge)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderChatMsg(msg) {
  return `<div class="autoplan-msg autoplan-msg-${msg.role}"><div class="autoplan-msg-bubble">${msg.html}</div></div>`;
}

// ── Chat actions ─────────────────────────────────────────────────────────────
function autoPlanQuickPrompt(text) {
  const input = document.getElementById('autoplan-input');
  if (input) input.value = text;
  autoPlanSend();
}

function autoPlanReset() {
  AutoPlanState.messages = [];
  AutoPlanState.suggestionCards = [];
  AutoPlanState.pendingCards = {};
  AutoPlanState.lastUserQuery = '';
  AutoPlanState.greeted = false;
  AutoPlanState.thinking = false;
  renderAutoPlan();
}

function placeKey(place) {
  if (!place) return '';
  return String(place.placeId || place.id || `${place.name || ''}|${place.lat ?? ''}|${place.lng ?? ''}`);
}

async function loadPlacePool(userText, categoryId) {
  let places = await findPlacesForAutoPlan(userText, categoryId);
  if (typeof window.rankPlacesForQuery === 'function') {
    places = window.rankPlacesForQuery(places, userText);
  }
  return places;
}

async function autoPlanSend() {
  if (AutoPlanState.thinking) return;
  const input = document.getElementById('autoplan-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  if (input) input.value = '';

  AutoPlanState.messages.push({ role: 'user', html: escapeHtml(text) });
  AutoPlanState.thinking = true;
  AutoPlanState.messages.push({
    role: 'ai',
    html: `<div class="autoplan-thinking"><span></span><span></span><span></span></div>`,
  });
  renderAutoPlan();

  try {
    const gaps = Planner.buildScheduleGaps(Store.calendarEvents);
    AutoPlanState.messages.pop(); // remove thinking bubble

    if (!gaps.length) {
      AutoPlanState.messages.push({
        role: 'ai',
        html: `<span class="autoplan-error">Your day is full — no open gaps to slot anything in.</span>`,
      });
      return;
    }

    const keywordIntents = parseUserIntent(text);
    const keywordMatched = keywordIntents.some(i => i.rationale?.includes('Matched'));
    const shortQuery = text.split(/\s+/).length <= 4;

    // Short, keyword-like requests (e.g. "boba") use Discover search directly —
    // more reliable than Gemini returning odd category ids.
    let suggestions = (keywordMatched && shortQuery)
      ? intentsToSuggestions(keywordIntents, gaps)
      : await tryAutoPlanWithAI(text, gaps);
    if (!suggestions.length) {
      suggestions = intentsToSuggestions(keywordIntents, gaps);
    }

    AutoPlanState.lastUserQuery = text;
    const usedPlaceKeys = [];
    let enriched = [];
    for (const s of suggestions) {
      const card = await enrichSuggestion(s, text, usedPlaceKeys);
      if (card) {
        usedPlaceKeys.push(placeKey(card.place));
        enriched.push(card);
      }
    }

    if (!enriched.length) {
      const retry = intentsToSuggestions(keywordIntents, gaps);
      for (const s of retry) {
        const card = await enrichSuggestion(s, text, usedPlaceKeys);
        if (card) {
          usedPlaceKeys.push(placeKey(card.place));
          enriched.push(card);
        }
      }
    }

    if (!enriched.length) {
      AutoPlanState.messages.push({
        role: 'ai',
        html: `<span class="autoplan-error">Couldn't find real spots for that. Try keywords like "coffee", "boba", "lunch", "study", "park", "gym", or "bookstore".</span>`,
      });
      return;
    }

    AutoPlanState.suggestionCards = enriched;
    enriched.forEach(c => { AutoPlanState.pendingCards[c.id] = c; });

    if (enriched.length === 1) {
      const c = enriched[0];
      AutoPlanState.messages.push({
        role: 'ai',
        html: `Found <strong>${escapeHtml(c.place.name)}</strong> (${escapeHtml(c.categoryLabel)}) for ${escapeHtml(Planner.minutesToTimeString(c.gap.startMinutes))}. Use the buttons below to add or skip.`,
      });
    } else {
      AutoPlanState.messages.push({
        role: 'ai',
        html: `Found ${enriched.length} spots — use <strong>Add to schedule</strong> or <strong>Skip</strong> on each card below.`,
      });
    }

  } catch (err) {
    AutoPlanState.messages.pop();
    AutoPlanState.messages.push({
      role: 'ai',
      html: `<span class="autoplan-error">Something went wrong: ${escapeHtml(String(err.message || err))}</span>`,
    });
  } finally {
    AutoPlanState.thinking = false;
    renderAutoPlan();
    if (document.getElementById('tab-today')?.classList.contains('active')) {
      renderToday();
    }
  }
}

// ── AI path (Gemini Flash) ───────────────────────────────────────────────────
// Returns an array of {category, title, gapIndex, durationMin, rationale}.
// Returns [] on any failure — caller falls back to keyword matching.
async function tryAutoPlanWithAI(userPrompt, gaps) {
  try {
    const events = Planner.getTodayEvents(Store.calendarEvents);
    const categoryIds = AUTOPLAN_CATEGORIES.map(c => c.id);
    const categoriesList = AUTOPLAN_CATEGORIES.map(c => `${c.id} (${c.label})`).join(', ');
    const eventLine = events.length
      ? events.map(e => `${e.time} ${e.title}${getEventLocation(e) ? ` at ${getEventLocation(e)}` : ''}`).join('; ')
      : 'no scheduled events today';
    const gapLine = gaps.map((g, i) => `[gap ${i}] ${g.label} (${g.duration} min available, ${g.badge})`).join('; ');

    const systemPrompt = `You are NaviGuide's auto-planning assistant for a UW Seattle student.

Available place categories: ${categoriesList}

Today's events: ${eventLine}
Today's free time gaps: ${gapLine}

Respond ONLY with valid JSON (no markdown fences, no extra prose) matching this schema:
{
  "suggestions": [
    {
      "category": "one of: ${categoryIds.join(', ')}",
      "title": "what activity (e.g. 'Coffee break', 'Bookstore browse')",
      "gapIndex": <integer — which gap from the list above, 0-indexed>,
      "durationMin": <integer, must be <= the gap's available minutes>,
      "rationale": "one short sentence explaining why this fits"
    }
  ]
}

Pick 1–3 suggestions matching the user's request. Each durationMin must fit inside the chosen gap. Output JSON only.`;

    const raw = await askGeminiFlash(userPrompt, systemPrompt, 500);
    const cleaned = String(raw || '').trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }

    const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    return list
      .filter(s => s && s.category)
      .map(s => ({ ...s, category: normalizeAutoplanCategory(s.category, userPrompt) }))
      .filter(s => AUTOPLAN_CATEGORIES.some(c => c.id === s.category) || DISCOVER_CATEGORY_IDS.has(s.category));
  } catch (err) {
    console.warn('[autoplan] AI failed, falling back to keywords:', err?.message || err);
    return [];
  }
}

function intentsToSuggestions(intents, gaps) {
  return intents.map((intent, i) => ({
    category: intent.category,
    title: intent.activity,
    gapIndex: i % gaps.length,
    durationMin: null,
    rationale: intent.rationale || '',
  }));
}

// ── Intent parsing (keyword-based, no LLM) ───────────────────────────────────
// Maps free-form user text to one or more place categories. Returns an array
// so prompts like "boba and study" produce two suggestions.
function parseUserIntent(userPrompt) {
  const foodFocus = typeof window.extractFoodFocusFromQuery === 'function'
    ? window.extractFoodFocusFromQuery(userPrompt)
    : null;
  if (foodFocus) {
    const label = foodFocus.label.charAt(0).toUpperCase() + foodFocus.label.slice(1);
    return [{
      category: 'dining',
      activity: `${label} spot`,
      rationale: `Matched "${foodFocus.matchedTerm}" in your request.`,
    }];
  }

  const text = ' ' + userPrompt.toLowerCase() + ' ';
  const KEYWORD_MAP = [
    { keywords: ['boba', 'bubble tea', 'bubble-tea', 'tapioca', 'milk tea'],         category: 'cafes',      activity: 'Boba run' },
    { keywords: ['coffee', 'espresso', 'latte', 'caffeine', 'cafe', 'café'],         category: 'cafes',      activity: 'Coffee break' },
    { keywords: ['study', 'grind', 'work session', 'homework', 'laptop', 'lock in'], category: 'cafes',      activity: 'Study session' },
    { keywords: ['lunch'],                                                           category: 'dining',     activity: 'Lunch break' },
    { keywords: ['dinner'],                                                          category: 'dining',     activity: 'Dinner stop' },
    { keywords: ['eat', 'food', 'hungry', 'restaurant', 'meal', 'brunch'],           category: 'dining',     activity: 'Meal break' },
    { keywords: ['museum', 'gallery', 'exhibit', 'art show'],                        category: 'museums',    activity: 'Museum visit' },
    { keywords: ['scenic', 'view', 'sights', 'sightseeing', 'explore', 'fun thing'], category: 'sightseeing',activity: 'Scenic break' },
    { keywords: ['book', 'bookstore', 'read', 'novel'],                              category: 'bookstores', activity: 'Bookstore browse' },
    { keywords: ['ice cream', 'gelato', 'scoop', 'dessert', 'sweet treat'],          category: 'ice-cream',  activity: 'Ice cream stop' },
    { keywords: ['park', 'outside', 'nature', 'fresh air', 'walk', 'stroll'],        category: 'park',       activity: 'Park stroll' },
    { keywords: ['gym', 'workout', 'fitness', 'exercise', 'lift', 'run'],            category: 'gym',        activity: 'Workout' },
    { keywords: ['grocery', 'groceries', 'market', 'food shopping', 'errand'],       category: 'grocery',    activity: 'Grocery run' },
  ];

  const matches = [];
  const seen = new Set();
  for (const m of KEYWORD_MAP) {
    if (m.keywords.some(k => {
      const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return re.test(text);
    })) {
      if (!seen.has(m.category)) {
        matches.push({ ...m, rationale: `Matched "${m.keywords.find(k => text.includes(k))}" in your request.` });
        seen.add(m.category);
      }
    }
  }

  // Fallback: if nothing matched, default to a cafe — safe, universally useful.
  if (!matches.length) {
    matches.push({ category: 'cafes', activity: 'A spot to chill', rationale: 'Best guess — a cafe is always a safe slot.' });
  }

  return matches.slice(0, 3);
}

// Drops a single enriched suggestion onto the calendar (Google if connected,
// otherwise local). Returns the formatted start time on success, null on fail.
async function addCardToCalendar(card) {
  const startTime = Planner.minutesToTimeString(card.gap.startMinutes);
  const todayStr = Planner.todayStr();
  const newEvent = {
    date: todayStr,
    time: startTime,
    title: card.title || card.place.name,
    loc: card.place.address || card.place.vicinity || card.place.name,
    location: card.place.address || card.place.vicinity || card.place.name,
    durationMinutes: card.durationMin,
    note: card.rationale || `Auto-planned ${card.categoryLabel}`,
    autoPlanned: true,
  };

  if (typeof window.createGoogleCalendarEvent === 'function' && typeof window.buildGoogleEventDateTime === 'function') {
    try {
      const dt = window.buildGoogleEventDateTime(startTime, card.durationMin);
      const resource = {
        summary: newEvent.title,
        location: newEvent.loc,
        description: `${newEvent.note}\n\nAuto-planned by NaviGuide.`,
        start: dt.start,
        end: dt.end,
      };
      const result = await window.createGoogleCalendarEvent(resource);
      if (result?.id) newEvent.googleId = result.id;
      if (result?.start?.dateTime || result?.start?.date) {
        newEvent.date = result.start.dateTime || result.start.date;
      }
    } catch (err) {
      console.warn('Google Calendar add failed; storing locally instead.', err);
    }
  }

  if (typeof Store.addCalendarEvents === 'function') {
    Store.addCalendarEvents([newEvent]);
  } else {
    Store.calendarEvents.push(newEvent);
    Store.calendarEvents.sort((a, b) => (parseTimeToMinutesLocal(a.time) || 0) - (parseTimeToMinutesLocal(b.time) || 0));
    if (typeof Store.setCalendarEvents === 'function') Store.setCalendarEvents(Store.calendarEvents);
  }

  card.added = true;
  return { startTime };
}

async function enrichSuggestion(suggestion, userText = '', excludePlaceKeys = []) {
  const categoryId = normalizeAutoplanCategory(suggestion.category, userText);
  const category = AUTOPLAN_CATEGORIES.find(c => c.id === categoryId)
    || { id: categoryId, label: categoryId, visitMinutes: 35 };

  const gaps = Planner.buildScheduleGaps(Store.calendarEvents);
  const gap = gaps[suggestion.gapIndex] || gaps[0];
  if (!gap) return null;

  try {
    const places = await loadPlacePool(userText, categoryId);
    if (!places.length) return null;

    const skipped = new Set(excludePlaceKeys);
    const place = places.find(p => !skipped.has(placeKey(p)));
    if (!place) return null;

    const dur = Math.min(
      Math.max(15, Number(suggestion.durationMin) || category.visitMinutes),
      gap.duration
    );
    const discoverLabel = window.DISCOVER_PLACE_TYPES?.find(t => t.id === categoryId)?.label;

    return {
      id: `autoplan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: suggestion.title || category.label,
      category: categoryId,
      categoryLabel: discoverLabel || category.label,
      place,
      placePool: places,
      skippedPlaceKeys: [...excludePlaceKeys, placeKey(place)],
      queryText: userText,
      gap,
      gapIndex: suggestion.gapIndex,
      durationMin: dur,
      rationale: suggestion.rationale || '',
      added: false,
    };
  } catch (err) {
    console.warn('autoplan enrich failed', err);
    return null;
  }
}

async function findPlacesForAutoPlan(userText, categoryId) {
  const normalized = normalizeAutoplanCategory(categoryId, userText);
  const useDiscover = DISCOVER_CATEGORY_IDS.has(normalized)
    && typeof window.searchDiscoverPlacesNearDay === 'function';

  if (useDiscover) {
    const { places } = await window.searchDiscoverPlacesNearDay({
      query: userText,
      categoryId: normalized,
    });
    if (places.length) return places;
  }

  const category = AUTOPLAN_CATEGORIES.find(c => c.id === normalized);
  if (!category) return [];

  const anchor = typeof window.getDiscoveryAnchor === 'function'
    ? window.getDiscoveryAnchor()
    : 'University of Washington, Seattle, WA';
  return searchPlacesForCategory(anchor, category);
}

function renderSuggestionCards(cards) {
  const visible = cards.filter(c => !c.dismissed);
  if (!visible.length) return '';
  return `<div class="autoplan-cards">${visible.map(c => `
    <div class="autoplan-card ${c.added ? 'is-added' : ''} ${c.dismissed ? 'is-dismissed' : ''}" id="autoplan-card-${c.id}">
      <div class="autoplan-card-head">
        <span class="autoplan-card-cat">${escapeHtml(c.categoryLabel)}</span>
        <span class="autoplan-card-time">${escapeHtml(Planner.minutesToTimeString(c.gap.startMinutes))} · ${c.durationMin} min</span>
      </div>
      <div class="autoplan-card-name">${escapeHtml(c.place.name)}</div>
      <div class="autoplan-card-addr">${escapeHtml(c.place.address || c.place.vicinity || '')}</div>
      ${typeof c.place.rating === 'number'
        ? `<div class="autoplan-card-rating">★ ${c.place.rating.toFixed(1)}${c.place.userRatingsTotal ? ` · ${c.place.userRatingsTotal} reviews` : ''}</div>`
        : ''}
      ${c.place.summary ? `<div class="autoplan-card-summary">${escapeHtml(c.place.summary)}</div>` : ''}
      ${c.rationale ? `<div class="autoplan-card-why">${escapeHtml(c.rationale)}</div>` : ''}
      <div class="autoplan-card-actions">
        ${c.added
          ? `<span class="autoplan-card-badge">✓ Added to your calendar</span>
             <button type="button" class="chip" data-autoplan-undo="${escapeAttr(c.id)}">Undo</button>`
          : `<button type="button" class="btn-primary autoplan-card-add" data-autoplan-add="${escapeAttr(c.id)}">Add to schedule</button>
             <button type="button" class="chip" data-autoplan-dismiss="${escapeAttr(c.id)}">Skip</button>`}
      </div>
    </div>
  `).join('')}</div>`;
}

// ── Calendar add ─────────────────────────────────────────────────────────────
async function autoPlanAddToSchedule(cardId) {
  const card = getAutoPlanCard(cardId);
  if (!card || card.added) return;

  const cardEl = document.getElementById(`autoplan-card-${cardId}`);
  const btn = cardEl?.querySelector('[data-autoplan-add]');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }

  const startTime = Planner.minutesToTimeString(card.gap.startMinutes);
  const todayStr = Planner.todayStr();
  const newEvent = {
    date: todayStr,
    time: startTime,
    title: card.title || card.place.name,
    loc: card.place.address || card.place.vicinity || card.place.name,
    location: card.place.address || card.place.vicinity || card.place.name,
    durationMinutes: card.durationMin,
    note: card.rationale || `Auto-planned ${card.categoryLabel}`,
    autoPlanned: true,
  };

  // Push to Google Calendar if connected, otherwise just store locally.
  if (typeof window.createGoogleCalendarEvent === 'function' && typeof window.buildGoogleEventDateTime === 'function') {
    try {
      const dt = window.buildGoogleEventDateTime(startTime, card.durationMin);
      const resource = {
        summary: newEvent.title,
        location: newEvent.loc,
        description: `${newEvent.note}\n\nAuto-planned by NaviGuide.`,
        start: dt.start,
        end: dt.end,
      };
      const result = await window.createGoogleCalendarEvent(resource);
      if (result?.id) newEvent.googleId = result.id;
      if (result?.start?.dateTime || result?.start?.date) {
        newEvent.date = result.start.dateTime || result.start.date;
      }
    } catch (err) {
      console.warn('Google Calendar add failed; storing locally instead.', err);
    }
  }

  if (typeof Store.addCalendarEvents === 'function') {
    Store.addCalendarEvents([newEvent]);
  } else {
    Store.calendarEvents.push(newEvent);
    Store.calendarEvents.sort((a, b) => (parseTimeToMinutesLocal(a.time) || 0) - (parseTimeToMinutesLocal(b.time) || 0));
    Store.setCalendarEvents(Store.calendarEvents);
  }

  card.added = true;
  AutoPlanState.pendingCards[cardId] = card;

  AutoPlanState.messages.push({
    role: 'ai',
    html: `✓ Added <strong>${escapeHtml(card.place.name)}</strong> at ${escapeHtml(startTime)}.`,
  });
  renderAutoPlan();

  // Refresh the Today tab map if it's the active one.
  if (document.getElementById('tab-today')?.classList.contains('active')) {
    renderToday();
  }
}

async function autoPlanDismiss(cardId) {
  const card = getAutoPlanCard(cardId);
  if (!card) return;

  const queryText = card.queryText || AutoPlanState.lastUserQuery || '';
  const skipped = new Set(card.skippedPlaceKeys || []);
  skipped.add(placeKey(card.place));

  let pool = card.placePool;
  if (!pool?.length) {
    pool = await loadPlacePool(queryText, card.category);
  }

  const next = pool.find(p => !skipped.has(placeKey(p)));

  if (!next) {
    AutoPlanState.suggestionCards = AutoPlanState.suggestionCards.filter(c => c.id !== cardId);
    delete AutoPlanState.pendingCards[cardId];
    AutoPlanState.messages.push({
      role: 'ai',
      html: `<span class="autoplan-error">No more nearby matches for that — try a different search.</span>`,
    });
    renderAutoPlan();
    return;
  }

  card.place = next;
  card.skippedPlaceKeys = [...skipped];
  card.placePool = pool;
  AutoPlanState.pendingCards[cardId] = card;

  AutoPlanState.messages.push({
    role: 'ai',
    html: `Skipped that one — try <strong>${escapeHtml(next.name)}</strong> instead.`,
  });
  renderAutoPlan();
}

// Remove an auto-added event from the calendar (both locally and Google).
function autoPlanUndo(cardId) {
  const card = getAutoPlanCard(cardId);
  if (!card || !card.added) return;

  const startTime = Planner.minutesToTimeString(card.gap.startMinutes);
  const matchTitle = card.title || card.place.name;

  // Remove the matching event from local storage.
  const before = Store.calendarEvents.length;
  Store.calendarEvents = Store.calendarEvents.filter(e =>
    !(e.autoPlanned && e.time === startTime && e.title === matchTitle)
  );
  if (Store.calendarEvents.length !== before && typeof Store.setCalendarEvents === 'function') {
    Store.setCalendarEvents(Store.calendarEvents);
  }

  card.added = false;
  AutoPlanState.pendingCards[cardId] = card;

  AutoPlanState.messages.push({
    role: 'ai',
    html: `Removed <strong>${escapeHtml(card.place.name)}</strong> from your calendar.`,
  });
  renderAutoPlan();

  if (document.getElementById('tab-today')?.classList.contains('active')) {
    renderToday();
  }
}

async function searchPlacesForCategory(anchor, category) {
  for (const radiusMiles of [1, 2, 3]) {
    try {
      const places = await MapsService.searchPlaces({
        centerAddress: anchor,
        radiusMiles,
        placeType: category,
      });
      if (places.length) return places;
    } catch (err) {
      console.warn('[autoplan] search failed', category.id, err?.message || err);
    }
  }
  return [];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseTimeToMinutesLocal(timeStr) {
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

window.renderAutoPlan = renderAutoPlan;
window.autoPlanSend = autoPlanSend;
window.autoPlanQuickPrompt = autoPlanQuickPrompt;
window.autoPlanReset = autoPlanReset;
window.autoPlanAddToSchedule = autoPlanAddToSchedule;
window.autoPlanDismiss = autoPlanDismiss;
window.autoPlanUndo = autoPlanUndo;
