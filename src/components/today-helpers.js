// Today tab planner UI helpers (next move, route legs, free time).

function buildNextMovePlaceholder() {
  return '<div class="next-move-loading">Calculating your next move…</div>';
}

function buildFreeTimePlaceholder(gaps) {
  if (!gaps.length) {
    return '<div class="card-label">Free time</div><p class="muted">No open gaps detected today.</p>';
  }
  const g = gaps.find(x => x.duration >= 40) || gaps[0];
  return `
    <div class="card-label">Free time finder</div>
    <div class="free-time-head">You have <strong>${Planner.formatDurationMinutes(g.duration)}</strong> free (${g.label})</div>
    <div id="free-time-recs" class="free-time-recs"><span class="muted">Loading ideas…</span></div>`;
}

async function hydrateTodayPlanner(events, visited, gaps, recs) {
  const next = await Planner.getNextMove(events);
  const card = document.getElementById('next-move-card');
  if (card && next) {
    const loc = getEventLocation(next.event);
    const statusClass = next.status.replace(/\s+/g, '-').toLowerCase();
    card.innerHTML = `
      <div class="next-move-status is-${statusClass}">${escapeHtml(next.status)}</div>
      <div class="next-move-title">Next: ${escapeHtml(next.event.title)}</div>
      <div class="next-move-meta">${escapeHtml(next.event.time || '')}${loc ? ` · ${escapeHtml(loc)}` : ''}</div>
      <div class="next-move-row">
        <span>Leave by <strong>${escapeHtml(next.leaveBy)}</strong></span>
        <span>~${next.travelMin} min ${next.travelMode === 'walk' ? 'walk' : 'bus/transit'}</span>
      </div>
      <div class="source-chips">${next.sources.map(s => `<span class="source-chip">${escapeHtml(s)}</span>`).join('')}</div>`;
  } else if (card) {
    card.innerHTML = '<p class="muted">No more events scheduled for today.</p>';
  }

  const legs = await Planner.buildRouteLegs(visited);
  const legsCard = document.getElementById('route-legs-card');
  const legsList = document.getElementById('route-legs-list');
  if (legs.length && legsCard && legsList) {
    legsCard.style.display = 'block';
    legsList.innerHTML = legs.map(l => `
      <div class="route-leg-row">
        <span>${escapeHtml(l.from)} → ${escapeHtml(l.to)}</span>
        <span class="route-leg-meta">${l.minutes} min · ${l.mode === 'walk' ? 'walk' : 'bus'}</span>
      </div>`).join('');
  }

  const ranked = Planner.rankRecsForGaps(recs, gaps);
  const freeEl = document.getElementById('free-time-recs');
  if (freeEl) {
    freeEl.innerHTML = ranked.length
      ? ranked.map(r => {
          const id = String(r.id || '').replace(/'/g, "\\'");
          return `<div class="free-time-item"><strong>${escapeHtml(r.name)}</strong><span>${escapeHtml(r.typeLabel || '')}</span><div class="free-time-actions"><button type="button" class="chip" onclick="saveMapRec(${JSON.stringify(String(r.id || ''))})">Save</button><button type="button" class="chip chip-accent" onclick="addRecToLocalCalendar(${JSON.stringify(r.name)}, ${JSON.stringify(r.address || '')})">Add</button></div></div>`;
        }).join('')
      : '<span class="muted">Refresh map recs for ideas.</span>';
  }

  updateTodaySuggestCopy(next, gaps, ranked);
}

function updateTodaySuggestCopy(next, gaps, ranked) {
  const body = document.getElementById('suggest-body');
  const sources = document.getElementById('suggest-sources');
  if (!body) return;
  const parts = [];
  if (next) parts.push(`Head to ${next.event.title} — leave by ${next.leaveBy} (${next.travelMin} min ${next.travelMode}).`);
  if (gaps.length) parts.push(`Best open window: ${gaps[0].label} (${gaps[0].badge}).`);
  if (ranked[0]) parts.push(`Quick fit: ${ranked[0].name} during your gap.`);
  body.textContent = parts.join(' ') || 'Connect your calendar for personalized guidance.';
  if (sources) {
    sources.innerHTML = ['Calendar', 'Map estimates', 'Your habits']
      .map(s => `<span class="source-chip">${s}</span>`).join('');
  }
}

function buildTodayExplainPrompt() {
  const events = Planner.getTodayEvents(Store.calendarEvents);
  return `Explain today's route in 3 short bullets. Events: ${events.map(e => `${e.time} ${e.title} at ${getEventLocation(e) || 'remote'}`).join('; ')}. Mention walk vs bus and one gap-time idea.`;
}

function explainTodayRoute() {
  askAI('suggest-ai-out', buildTodayExplainPrompt());
}

function saveMapRec(id) {
  if (!id) return;
  Store.saveRec(id);
}

function dismissMapRec(id) {
  if (!id) return;
  Store.dismissRec(id);
  renderToday();
}

window.saveMapRec = saveMapRec;
window.dismissMapRec = dismissMapRec;
window.explainTodayRoute = explainTodayRoute;
function addRecToLocalCalendar(name, address) {
  if (!name) return;
  const date = Planner.todayStr();
  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  Store.addCalendarEvents([{
    date,
    time,
    title: name,
    loc: address,
    location: address,
    durationMinutes: 60
  }]);
  renderToday();
}

window.addRecToLocalCalendar = addRecToLocalCalendar;
