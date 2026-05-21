// Plan Trip tab — questionnaire, 3-plan compare, refinement, calendar add.

const PlanTripState = {
  step: 'form',
  answers: null,
  activeDay: 1,
  plans: [],
  rejectedSummaries: [],
  selectedPlanId: null,
  loading: false
};

const CITY_CHIPS = [
  'Seattle', 'UW campus', 'Capitol Hill', 'Ballard', 'Fremont', 'Downtown Seattle', 'Bellevue'
];
const VIBE_OPTIONS = ['Relaxed', 'Food-focused', 'Sightseeing', 'Hidden gems', 'Family-friendly'];
const MEAL_OPTIONS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
const TRANSPORT_OPTIONS = ['Mostly walk', 'Mix walk + bus', 'Minimize transfers'];

const DEFAULT_ANSWERS = {
  city: 'Seattle',
  days: 1,
  dayStart: '9:00 AM',
  dayEnd: '9:00 PM',
  budget: 80,
  vibes: ['Food-focused'],
  meals: ['Lunch', 'Dinner', 'Snacks'],
  activity: 'Moderate',
  transport: 'Mix walk + bus',
  mustInclude: '',
  avoid: ''
};

function renderPlanTrip() {
  const pane = document.getElementById('tab-plan-trip');
  if (!pane) return;

  const draft = Store.getPlanTripDraft?.();
  if (draft?.answers && !PlanTripState.answers) {
    PlanTripState.answers = draft.answers;
    PlanTripState.activeDay = draft.activeDay || 1;
    if (draft.plans?.length) {
      PlanTripState.plans = draft.plans;
      PlanTripState.step = 'plans';
    }
  }

  if (PlanTripState.step === 'form') {
    pane.innerHTML = renderPlanTripForm(PlanTripState.answers || DEFAULT_ANSWERS);
    bindPlanTripForm();
    return;
  }

  if (PlanTripState.step === 'plans') {
    pane.innerHTML = renderPlanTripCompare();
    return;
  }
}

function renderPlanTripForm(a) {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">Plan Trip</motion>
        <div class="page-sub">Tell us what you want — we'll build 3 day plans to compare</div>
      </motion>
    </motion>

    <motion class="card plan-trip-form" id="plan-trip-form">
      <motion class="card-label">Where & when</motion>
      <motion class="form-grid plan-chip-row">
        ${CITY_CHIPS.map(c => `<button type="button" class="plan-chip ${a.city === c ? 'active' : ''}" data-city="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
      </motion>
      <input type="text" id="pt-city" class="plan-input" placeholder="City or neighborhood" value="${escapeHtml(a.city)}" />

      <motion class="form-grid" style="grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">
        <label>Days (1–10)<input type="number" id="pt-days" min="1" max="10" value="${a.days}" /></label>
        <label>Start<input type="text" id="pt-start" value="${escapeHtml(a.dayStart)}" /></label>
        <label>End<input type="text" id="pt-end" value="${escapeHtml(a.dayEnd)}" /></label>
      </motion>

      <motion class="card-label" style="margin-top:16px">Vibe</motion>
      <motion class="plan-chip-row">${VIBE_OPTIONS.map(v => chipHtml('vibe', v, a.vibes)).join('')}</motion>

      <motion class="card-label">Meals & snacks</motion>
      <motion class="plan-chip-row">${MEAL_OPTIONS.map(m => chipHtml('meal', m, a.meals)).join('')}</motion>

      <motion class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
        <label>Activity level
          <select id="pt-activity">
            <option ${a.activity === 'Low' ? 'selected' : ''}>Low</option>
            <option ${a.activity === 'Moderate' ? 'selected' : ''}>Moderate</option>
            <option ${a.activity === 'Packed' ? 'selected' : ''}>Packed</option>
          </select>
        </label>
        <label>Daily budget ($)<input type="number" id="pt-budget" min="20" max="500" value="${a.budget}" /></label>
      </motion>

      <motion class="card-label">Getting around</motion>
      <motion class="plan-chip-row">${TRANSPORT_OPTIONS.map(t => `<button type="button" class="plan-chip ${a.transport === t ? 'active' : ''}" data-transport="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</motion>

      <motion class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
        <label>Must include<textarea id="pt-must" rows="2" placeholder="e.g. Pike Place, sushi">${escapeHtml(a.mustInclude)}</textarea></label>
        <label>Avoid<textarea id="pt-avoid" rows="2" placeholder="e.g. long hikes">${escapeHtml(a.avoid)}</textarea></label>
      </motion>

      <button type="button" class="btn-primary" style="margin-top:16px" id="pt-generate-btn">Generate 3 plans</button>
    </motion>`;
}

function chipHtml(kind, label, selectedList) {
  const on = (selectedList || []).includes(label);
  return `<button type="button" class="plan-chip ${on ? 'active' : ''}" data-${kind}="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}

function bindPlanTripForm() {
  const form = document.getElementById('plan-trip-form');
  if (!form) return;

  form.querySelectorAll('[data-city]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('pt-city').value = btn.dataset.city;
      form.querySelectorAll('[data-city]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  form.querySelectorAll('[data-transport]').forEach(btn => {
    btn.addEventListener('click', () => {
      form.querySelectorAll('[data-transport]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  ['vibe', 'meal'].forEach(kind => {
    form.querySelectorAll(`[data-${kind}]`).forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('active'));
    });
  });

  document.getElementById('pt-generate-btn')?.addEventListener('click', () => generateThreePlans());
}

function collectPlanTripAnswers() {
  const form = document.getElementById('plan-trip-form');
  const vibes = [...form.querySelectorAll('[data-vibe].active')].map(b => b.dataset.vibe);
  const meals = [...form.querySelectorAll('[data-meal].active')].map(b => b.dataset.meal);
  const transportBtn = form.querySelector('[data-transport].active');
  return {
    city: document.getElementById('pt-city').value.trim() || 'Seattle',
    days: Math.min(10, Math.max(1, Number(document.getElementById('pt-days').value) || 1)),
    dayStart: document.getElementById('pt-start').value.trim() || '9:00 AM',
    dayEnd: document.getElementById('pt-end').value.trim() || '9:00 PM',
    budget: Number(document.getElementById('pt-budget').value) || 80,
    vibes: vibes.length ? vibes : ['Food-focused'],
    meals: meals.length ? meals : ['Lunch', 'Dinner'],
    activity: document.getElementById('pt-activity').value,
    transport: transportBtn?.dataset.transport || 'Mix walk + bus',
    mustInclude: document.getElementById('pt-must').value.trim(),
    avoid: document.getElementById('pt-avoid').value.trim()
  };
}

async function generateThreePlans() {
  const answers = collectPlanTripAnswers();
  PlanTripState.answers = answers;
  PlanTripState.activeDay = 1;
  PlanTripState.rejectedSummaries = [];
  Store.setPlanTripDraft?.({ answers, activeDay: 1, plans: [] });

  const btn = document.getElementById('pt-generate-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  try {
    const plans = await fetchPlansFromAI(answers, PlanTripState.activeDay, 3);
    PlanTripState.plans = plans;
    PlanTripState.step = 'plans';
    Store.setPlanTripDraft?.({ answers, activeDay: PlanTripState.activeDay, plans });
    renderPlanTrip();
  } catch (err) {
    alert(err.message || 'Could not generate plans. Add your Gemini API key in the sidebar.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate 3 plans'; }
  }
}

async function fetchPlansFromAI(answers, dayNum, count = 3, refinement = '') {
  if (!window.askGeminiJSON) throw new Error('AI not available');
  const prefs = Store.getPreferences?.() || {};
  const prompt = buildPlanTripPrompt(answers, dayNum, count, refinement, prefs);
  const data = await askGeminiJSON(prompt, buildPlanTripSystemPrompt(), 2800);
  const plans = (data.plans || []).slice(0, count).map((p, i) => normalizePlan(p, i));
  return plans;
}

function buildPlanTripSystemPrompt() {
  return 'You are NaviGuide trip planner. Return ONLY valid JSON. Use real venue names when possible; if unsure use "TBD near [area]". Respect budget and walking preferences. No markdown.';
}

function buildPlanTripPrompt(answers, dayNum, count, refinement, prefs) {
  const archetypes = count === 1
    ? ['Revised plan based on user feedback']
    : ['Balanced Explorer', 'Budget-Smart Local', 'Experience-Rich Day'];
  return `Create ${count} distinct day plans for Day ${dayNum} in ${answers.city}.
Window: ${answers.dayStart} to ${answers.dayEnd}. Daily budget cap: $${answers.budget}.
Vibes: ${answers.vibes.join(', ')}. Meals wanted: ${answers.meals.join(', ')}. Activity: ${answers.activity}. Transport: ${answers.transport}.
Must include: ${answers.mustInclude || 'none'}. Avoid: ${answers.avoid || 'none'}.
User prefers max walk ~${prefs.maxWalkMinutes || 25} min between nearby stops.
${refinement ? `User feedback: ${refinement}` : ''}
${PlanTripState.rejectedSummaries.length ? `Rejected plans summary: ${PlanTripState.rejectedSummaries.join(' | ')}` : ''}

Return JSON:
{"plans":[{"id":"a","title":"${archetypes[0] || 'Plan A'}","archetype":"...","pros":"2-3 sentences","cons":"2-3 sentences","totalCost":0,"stops":[{"time":"10:00 AM","title":"...","type":"meal|snack|activity","location":"full address","cost":0,"durationMinutes":45,"why":"brief"}]}]}

Plans must differ meaningfully. Include meals, snacks, and activities.`;
}

function normalizePlan(p, index) {
  const stops = (p.stops || []).map((s, i) => ({
    ...s,
    id: s.id || `stop-${index}-${i}`,
    cost: Number(s.cost) || 0,
    durationMinutes: Number(s.durationMinutes) || 45
  }));
  const totalCost = stops.reduce((a, s) => a + s.cost, 0);
  return {
    id: p.id || `plan-${index}`,
    title: p.title || `Plan ${String.fromCharCode(65 + index)}`,
    archetype: p.archetype || p.title,
    pros: p.pros || '',
    cons: p.cons || '',
    stops,
    totalCost: Number(p.totalCost) || totalCost
  };
}

function renderPlanTripCompare() {
  const a = PlanTripState.answers || DEFAULT_ANSWERS;
  const dayTabs = Array.from({ length: a.days }, (_, i) => {
    const d = i + 1;
    return `<button type="button" class="plan-day-tab ${PlanTripState.activeDay === d ? 'active' : ''}" onclick="planTripSelectDay(${d})">Day ${d}</button>`;
  }).join('');

  const planCards = PlanTripState.plans.map(p => `
    <motion class="plan-card">
      <motion class="plan-card-head">
        <h3>${escapeHtml(p.title)}</h3>
        <span class="plan-cost">$${p.totalCost} / $${a.budget}</span>
      </motion>
      <p class="plan-pros"><strong>Pros:</strong> ${escapeHtml(p.pros)}</p>
      <p class="plan-cons"><strong>Cons:</strong> ${escapeHtml(p.cons)}</p>
      <motion class="plan-timeline">${p.stops.map(s => `
        <motion class="plan-stop">
          <span class="plan-stop-time">${escapeHtml(s.time)}</span>
          <span class="plan-stop-title">${escapeHtml(s.title)}</span>
          <span class="plan-stop-meta">${escapeHtml(s.type)} · $${s.cost} · ${s.durationMinutes}m</span>
        </motion>`).join('')}</motion>
      <motion class="plan-card-actions">
        <button type="button" class="btn-primary" onclick="planTripPick('${p.id}')">Add to calendar</button>
      </motion>
    </motion>`).join('');

  return `
    <motion class="page-header">
      <motion><motion class="page-title">Compare plans</motion><motion class="page-sub">${escapeHtml(a.city)} · Day ${PlanTripState.activeDay}</motion></motion>
      <button type="button" class="btn-secondary" onclick="planTripBackToForm()">Edit questionnaire</button>
    </motion>

    <motion class="plan-day-tabs">${dayTabs}</motion>

    <motion class="plan-compare-grid">${planCards || '<p>Generating…</p>'}</motion>

    <motion class="card plan-refine-card">
      <motion class="card-label">Not quite right?</motion>
      <motion class="form-grid" style="grid-template-columns:1fr auto">
        <input type="text" id="pt-refine-input" placeholder="e.g. less walking, cheaper lunch, more museums" />
        <button type="button" class="btn-secondary" id="pt-refine-btn">Generate 1 new plan</button>
      </motion>
    </motion>`;
}

function planTripSelectDay(day) {
  PlanTripState.activeDay = day;
  generateThreePlans();
}

function planTripBackToForm() {
  PlanTripState.step = 'form';
  renderPlanTrip();
}

async function planTripRefine() {
  const input = document.getElementById('pt-refine-input');
  const feedback = input?.value?.trim();
  if (!feedback) return;

  const btn = document.getElementById('pt-refine-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  PlanTripState.rejectedSummaries = PlanTripState.plans.map(p => `${p.title}: ${p.cons}`).slice(-3);

  try {
    const plans = await fetchPlansFromAI(PlanTripState.answers, PlanTripState.activeDay, 1, feedback);
    if (plans[0]) PlanTripState.plans = [plans[0], ...PlanTripState.plans.slice(0, 2)];
    if (input) input.value = '';
    renderPlanTrip();
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate 1 new plan'; }
  }
}

function planTripPick(planId) {
  const plan = PlanTripState.plans.find(p => p.id === planId);
  if (!plan) return;
  showPlanCalendarPreview(plan);
}

function showPlanCalendarPreview(plan) {
  const existing = document.getElementById('plan-preview-modal');
  if (existing) existing.remove();

  const date = getPlanTripDate(PlanTripState.activeDay);
  const rows = plan.stops.map(s => `
    <li><strong>${escapeHtml(s.time)}</strong> ${escapeHtml(s.title)} — ${escapeHtml(s.location)} (${s.durationMinutes}m)</li>`).join('');

  const modal = document.createElement('div');
  modal.id = 'plan-preview-modal';
  modal.className = 'plan-modal-overlay';
  modal.innerHTML = `
    <motion class="plan-modal">
      <h3>Add "${escapeHtml(plan.title)}" to calendar?</h3>
      <p class="muted">${plan.stops.length} events on ${date}</p>
      <ul class="plan-preview-list">${rows}</ul>
      <motion class="plan-modal-actions">
        <button type="button" class="btn-primary" onclick="confirmPlanToCalendar('${plan.id}')">Add to calendar</button>
        <button type="button" class="btn-secondary" onclick="document.getElementById('plan-preview-modal').remove()">Cancel</button>
      </motion>
    </motion>`;
  modal.innerHTML = modal.innerHTML.replace(/<motion/g, '<div').replace(/<\/motion>/g, '</motion>').replace(/<\/motion>/g, '</motion>');
  modal.innerHTML = modal.innerHTML.replace(/<motion/g, '<div').replace(/<\/motion>/g, '</div>');
  document.body.appendChild(modal);
}

function getPlanTripDate(dayOffset) {
  const d = new Date();
  d.setDate(d.getDate() + (dayOffset - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function confirmPlanToCalendar(planId) {
  const plan = PlanTripState.plans.find(p => p.id === planId);
  if (!plan) return;
  const date = getPlanTripDate(PlanTripState.activeDay);
  const newEvents = plan.stops.map(s => ({
    date,
    time: s.time,
    title: s.title,
    loc: s.location,
    location: s.location,
    durationMinutes: s.durationMinutes,
    type: s.type === 'meal' ? 'food' : s.type
  }));

  Store.addCalendarEvents(newEvents);

  for (const s of plan.stops) {
    if (window.createGoogleCalendarEvent && window.buildGoogleEventDateTime) {
      try {
        const dt = window.buildGoogleEventDateTime(s.time, s.durationMinutes);
        await window.createGoogleCalendarEvent({
          summary: s.title,
          location: s.location,
          description: s.why || 'Planned with NaviGuide',
          ...dt
        });
      } catch {}
    }
  }

  document.getElementById('plan-preview-modal')?.remove();
  showPlanTripToast('Added to your calendar! <a href="#" onclick="goToTodayTab();return false">View on Today</a>');
}

function showPlanTripToast(html) {
  const t = document.createElement('div');
  t.className = 'plan-toast';
  t.innerHTML = html;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

function goToTodayTab() {
  document.querySelector('.nav-item[data-tab="today"]')?.click();
}

document.addEventListener('click', e => {
  if (e.target?.id === 'pt-refine-btn') planTripRefine();
});

window.renderPlanTrip = renderPlanTrip;
window.planTripSelectDay = planTripSelectDay;
window.planTripBackToForm = planTripBackToForm;
window.planTripPick = planTripPick;
window.confirmPlanToCalendar = confirmPlanToCalendar;
window.goToTodayTab = goToTodayTab;
