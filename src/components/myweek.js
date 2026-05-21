// "My Week" tab — every calendar event that isn't today, grouped by date.
// Uses the same renderCalendarGroups() helper as the Today tab so the styling
// stays consistent.

function renderMyWeek() {
  const pane = document.getElementById('tab-myweek');
  if (!pane) return;

  const events = Array.isArray(Store.calendarEvents) ? Store.calendarEvents : [];
  const todayStr = Planner?.todayStr ? Planner.todayStr() : (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  })();

  const upcoming = events
    .filter(e => {
      const d = e?.date ? String(e.date).split('T')[0].slice(0, 10) : '';
      return d && d > todayStr;
    })
    .sort((a, b) => {
      const da = String(a.date).split('T')[0].slice(0, 10);
      const db = String(b.date).split('T')[0].slice(0, 10);
      if (da !== db) return da.localeCompare(db);
      return (myWeekTimeToMinutes(a.time) ?? 9999) - (myWeekTimeToMinutes(b.time) ?? 9999);
    });

  const past = events
    .filter(e => {
      const d = e?.date ? String(e.date).split('T')[0].slice(0, 10) : '';
      return d && d < todayStr;
    })
    .sort((a, b) => {
      // Most recent first.
      const da = String(a.date).split('T')[0].slice(0, 10);
      const db = String(b.date).split('T')[0].slice(0, 10);
      if (da !== db) return db.localeCompare(da);
      return (myWeekTimeToMinutes(b.time) ?? 9999) - (myWeekTimeToMinutes(a.time) ?? 9999);
    });

  // Build a 7-day "what's coming up" preview strip from upcoming events.
  const weekRange = buildMyWeekRange();

  pane.innerHTML = `
    <div class="page-header today-header">
      <div>
        <div class="page-eyebrow">UPCOMING</div>
        <div class="page-title">My Week</div>
        <div class="page-sub">${upcoming.length} event${upcoming.length === 1 ? '' : 's'} ahead${past.length ? ` · ${past.length} past` : ''}</div>
      </div>
      <button class="chip" onclick="renderMyWeek()" title="Refresh">↺ Refresh</button>
    </div>

    <div class="myweek-strip">
      ${weekRange.map(day => {
        const count = upcoming.filter(e => String(e.date).split('T')[0].slice(0, 10) === day.iso).length;
        return `
          <div class="myweek-day-pill ${count ? 'is-active' : ''}">
            <div class="myweek-day-name">${escapeHtml(day.short)}</div>
            <div class="myweek-day-num">${day.num}</div>
            <div class="myweek-day-count">${count ? `${count} ev` : '—'}</div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="card">
      <div class="card-label">Upcoming</div>
      ${upcoming.length
        ? renderCalendarGroups(upcoming)
        : '<p class="muted" style="margin:6px 0 0">Nothing scheduled this week — you\'re free.</p>'}
    </div>

    ${past.length ? `
      <details class="myweek-past">
        <summary><span class="card-label">Past events (${past.length})</span></summary>
        <div class="card" style="margin-top:8px">${renderCalendarGroups(past)}</div>
      </details>
    ` : ''}
  `;
}

// Build [today+1 .. today+7] day descriptors for the strip.
function buildMyWeekRange() {
  const out = [];
  const base = new Date();
  for (let i = 1; i <= 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({
      iso,
      short: d.toLocaleDateString('en-US', { weekday: 'short' }),
      num: d.getDate(),
    });
  }
  return out;
}

function myWeekTimeToMinutes(timeStr) {
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

window.renderMyWeek = renderMyWeek;
