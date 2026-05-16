function formatCalDate(date) {
  return date ? new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date';
}

function renderCalendarGroups(events) {
  const grouped = events.reduce((acc, e) => {
    const label = formatCalDate(e.date);
    if (!acc[label]) acc[label] = [];
    acc[label].push(e);
    return acc;
  }, {});

  return Object.entries(grouped).map(([label, dayEvents]) => `
    <div class="cal-day-group">
      <div class="cal-day-divider">${label}</div>
      ${dayEvents.map(e => `
        <div class="cal-row">
          <div class="cal-time">${e.time}</div>
          <div class="cal-body">
            <div class="cal-title">${e.title}</div>
            ${e.loc ? `<div class="cal-loc">${e.loc}</div>` : '<div class="cal-loc" style="color:var(--text3)">Remote</div>'}
            ${e.depart ? `<div class="cal-pill">Leave by ${e.depart} · ~${e.eta}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function renderToday() {
  const pane = document.getElementById('tab-today');
  const stats = Store.getStats();
  const events = Store.calendarEvents;

  pane.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Today</div>
        <div class="page-sub">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</div>
      </div>
    </div>

    <div style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <button id="google-calendar-connect-btn" class="btn-primary" onclick="loadGoogleCalendar()">
        Connect Google Calendar
      </button>
      <span id="google-calendar-activity" style="font-size:14px;color:var(--text2);">
        Google Calendar not connected
      </span>
    </div>

    <div class="suggest" id="today-suggest">
      <div class="suggest-label">AI route suggestion</div>
      <div class="suggest-title">Optimized day ahead</div>
      <div class="suggest-body">You have lunch in Capitol Hill at 12pm and gym at 6pm. Leave by 11:42 AM — and consider swapping your usual coffee stop to Broadcast on the return trip to save 9 min total.</div>
      <div class="chips">
        <button class="chip chip-accent" onclick="this.closest('.suggest').style.display='none'">Sounds good</button>
        <button class="chip" onclick="askAI('suggest-ai-out', 'Give me 2 alternative route options for today that avoid highway traffic')">More options</button>
      </div>
      <div class="ai-response" id="suggest-ai-out"></div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-val">${events.filter(e=>e.loc).length}</div>
        <div class="stat-lbl">trips today</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${events.filter(e=>e.loc).reduce((a,e)=>a+parseInt(e.eta||0),0)} min</div>
        <div class="stat-lbl">travel time</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${stats.avgDur} min</div>
        <div class="stat-lbl">your avg commute</div>
      </div>
    </div>

    <div class="card">
      <div class="card-label">Calendar</div>
      ${renderCalendarGroups(events)}
    </div>

    <div class="card">
      <div class="card-label">Route map</div>
      <div id="map" class="map-box"></div>
    </div>

    <div class="card">
      <div class="card-label">Ask AI about today</div>
      <div class="form-grid" style="grid-template-columns:1fr auto">
        <input type="text" id="today-q" placeholder="e.g. What's the best time to leave for my 3pm?" />
        <button class="btn-primary" onclick="askAIFromInput('today-q','today-ai-out')">Ask</button>
      </div>
      <div class="ai-response" id="today-ai-out"></div>
    </div>
  `;
  if (window.updateGoogleCalendarStatus) updateGoogleCalendarStatus();
}
