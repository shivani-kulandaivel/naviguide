// Main application entrypoint and Google Calendar integration logic.
// This file initializes the UI, manages Google auth tokens, syncs calendar events,
// and exposes helper actions for the rest of the UI.
const GOOGLE_CLIENT_ID = "818886256150-8dapdbmbhiq57taek1b62mr8veikhafr.apps.googleusercontent.com";
const App = (() => {
  // Bootstraps the app when the page loads.
  // Renders each tab, attaches navigation handlers, then attempts
  // to restore a saved Google Calendar session if one exists.
  async function init() {
    await MapsService.getApiKey();
    renderToday();
    renderLog();
    renderDiscover();
    setupNav();
    setupApiKey();
    Store.removeSocialCalendarEvents?.();
    if (window.UwEventsService) {
      try {
        await UwEventsService.refreshCampusEvents();
        renderToday();
      } catch (err) {
        console.warn('Campus events refresh skipped', err);
      }
    }
    await restoreGoogleCalendarSession();
  }
  // comment

  // Setup top-level sidebar tab navigation.
  // Clicking a nav item makes it active and renders the associated tab.
  function setupNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

        if (btn.dataset.tab === 'today') renderToday();
        if (btn.dataset.tab === 'discover') renderDiscover();
      });
    });
  }

  // Reflect whether the AI API key is configured in the sidebar status.
  async function setupApiKey() {
    const key = await getGeminiApiKey();
    const dot = document.querySelector('.status-dot');
    const txt = document.querySelector('.status-text');
    if (key) {
      dot.className = 'status-dot';
      txt.textContent = 'AI ready';
    } else {
      dot.className = 'status-dot error';
      txt.textContent = 'No API key';
    }
  }

  const GOOGLE_CALENDAR_TOKEN_KEY = 'wayfarer_google_calendar_access_token';
  const GOOGLE_CALENDAR_TOKEN_EXPIRES_KEY = 'wayfarer_google_calendar_access_token_expires';

  let googleCalendarTokenClient = null;
  let googleCalendarConnected = false;
  let googleCalendarClientReady = false;
  let googleCalendarInitPromise = null;
  const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

  // Persist Google Calendar access token locally for session restoration.
  // Persist the Google Calendar access token and expiry to localStorage.
  function saveGoogleCalendarToken(accessToken, expiresIn) {
    try {
      const expiresAt = Date.now() + (expiresIn || 3600) * 1000 - 60000;
      localStorage.setItem(GOOGLE_CALENDAR_TOKEN_KEY, accessToken);
      localStorage.setItem(GOOGLE_CALENDAR_TOKEN_EXPIRES_KEY, expiresAt.toString());
    } catch {}
  }

  // Remove stored Google auth tokens when the session is invalidated.
  function clearGoogleCalendarToken() {
    try {
      localStorage.removeItem(GOOGLE_CALENDAR_TOKEN_KEY);
      localStorage.removeItem(GOOGLE_CALENDAR_TOKEN_EXPIRES_KEY);
    } catch {}
  }

  // Return a saved Google token if it exists and has not expired.
  function getSavedGoogleCalendarToken() {
    try {
      const token = localStorage.getItem(GOOGLE_CALENDAR_TOKEN_KEY);
      const expiresAt = parseInt(localStorage.getItem(GOOGLE_CALENDAR_TOKEN_EXPIRES_KEY), 10);
      if (!token || Number.isNaN(expiresAt) || Date.now() > expiresAt) return null;
      return token;
    } catch {
      return null;
    }
  }

  // Try to restore a previous Google Calendar auth session and sync events.
  // Attempt to restore a previously-authorized Google Calendar session.
  // If successful, set the token and sync the users calendar events.
  async function restoreGoogleCalendarSession() {
    const savedToken = getSavedGoogleCalendarToken();
    if (!savedToken) return false;

    if (!googleCalendarClientReady) {
      await initGoogleCalendarClient();
    }

    try {
      gapi.client.setToken({ access_token: savedToken });
      googleCalendarConnected = true;
      updateGoogleCalendarStatus();
      await syncGoogleCalendar();
      renderToday(); // Only reached when restoring a saved session (not on fresh token grant)
      return true;
    } catch (err) {
      clearGoogleCalendarToken();
      console.warn('Failed to restore Google Calendar session', err);
      return false;
    }
  }

  // Update the connect button and status text for Google Calendar state.
  function updateGoogleCalendarStatus() {
    const btn = document.getElementById('google-calendar-connect-btn');
    const status = document.getElementById('google-calendar-activity');
    if (btn) {
      btn.textContent = googleCalendarConnected ? 'Refresh Google Calendar' : 'Connect Google Calendar';
    }
    if (status) {
      status.textContent = googleCalendarConnected ? 'Connected to Google Calendar' : 'Google Calendar not connected';
    }
  }

  // Initialize the Google API client only once for Calendar calls.
  async function initGoogleCalendarClient() {
    if (googleCalendarInitPromise) return googleCalendarInitPromise;
    googleCalendarInitPromise = new Promise((resolve, reject) => {
      gapi.load('client', async () => {
        try {
          await gapi.client.init({
            apiKey: await MapsService.getApiKey(),
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest']
          });
          googleCalendarClientReady = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
    return googleCalendarInitPromise;
  }

  // Ensure an OAuth token client exists for requesting Calendar permissions.
  function ensureGoogleCalendarTokenClient() {
    if (!googleCalendarTokenClient) {
      googleCalendarTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_CALENDAR_SCOPE,
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            console.error(tokenResponse);
            alert('Google Calendar authorization failed.');
            return;
          }

          gapi.client.setToken({ access_token: tokenResponse.access_token });
          saveGoogleCalendarToken(tokenResponse.access_token, tokenResponse.expires_in);
          googleCalendarConnected = true;
          updateGoogleCalendarStatus();

          try {
            await syncGoogleCalendar();
            renderToday();
          } catch (err) {
            console.error('Google sync failed', err);
          }
        }
      });
    }
    return googleCalendarTokenClient;
  }

  // Return whether the app currently has a valid Google Calendar auth token.
  function isGoogleCalendarConnected() {
    return googleCalendarConnected && !!gapi.client.getToken()?.access_token;
  }

  // Convert a display time string to hour/minute values.
  function parseCalendarTime(timeStr) {
    if (!timeStr || timeStr === '—' || timeStr === 'All Day') return null;
    const parts = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!parts) return null;
    let hour = Number(parts[1]);
    const minute = Number(parts[2]);
    const ampm = parts[3]?.toUpperCase();
    if (ampm) {
      if (ampm === 'PM' && hour !== 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
    }
    return { hour, minute };
  }

  // Build Google Calendar event start/end objects from a user-friendly time.
  function buildGoogleEventDateTime(timeStr, durationMinutes = 45) {
    const time = parseCalendarTime(timeStr);
    const start = new Date();
    if (time) {
      start.setHours(time.hour, time.minute, 0, 0);
    }
    const end = new Date(start.getTime() + durationMinutes * 60000);
    return {
      start: { dateTime: start.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      end: { dateTime: end.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
    };
  }

  // Fetch upcoming Google Calendar events and merge them into local events.
  // Local events without googleId are preserved and remote events are deduplicated.
  // Fetch the user's upcoming Google Calendar events and merge them with local events.
  async function syncGoogleCalendar() {
    if (!isGoogleCalendarConnected()) return;
    if (!googleCalendarClientReady) await initGoogleCalendarClient();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endWindow = new Date(startOfToday);
    endWindow.setDate(endWindow.getDate() + 7);

    const response = await gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfToday.toISOString(),
      timeMax: endWindow.toISOString(),
      showDeleted: false,
      singleEvents: true,
      maxResults: 50,
      orderBy: 'startTime'
    });

    const remoteEvents = response.result.items.map(event => {
      const startISO = event.start?.dateTime || event.start?.date || null;
      const endISO = event.end?.dateTime || event.end?.date || null;
      const durationMinutes = startISO && endISO && event.start?.dateTime && event.end?.dateTime
        ? Math.max(15, Math.round((new Date(endISO) - new Date(startISO)) / 60000))
        : null;
      return {
        googleId: event.id,
        source: 'google',
        date: startISO,
        end: endISO,
        durationMinutes,
        time: event.start?.dateTime
          ? new Date(event.start.dateTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          : 'All Day',
        title: event.summary || 'Untitled Event',
        loc: event.location || null,
        location: event.location || null
      };
    });

    Store.mergeCalendarEvents(remoteEvents, { replaceSource: 'google' });
  }

  // Create a new event in the user's Google Calendar.
  // This is used by the Discover module when a suggested stop is scheduled.
  // Create a new Google Calendar event. Returns the inserted event result.
  async function createGoogleCalendarEvent(resource) {
    if (!isGoogleCalendarConnected()) {
      await restoreGoogleCalendarSession();
      if (!isGoogleCalendarConnected()) return null;
    }
    if (!googleCalendarClientReady) await initGoogleCalendarClient();

    const response = await gapi.client.calendar.events.insert({
      calendarId: 'primary',
      resource
    });
    return response.result;
  }

  // Return today's date string in YYYY-MM-DD format for event storage.
  function getTodayDateString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }

  // Start the Google Calendar auth flow or refresh an existing connection.
  async function loadGoogleCalendar() {
    try {
      await initGoogleCalendarClient();
      ensureGoogleCalendarTokenClient();
      // Try to use a saved valid token first. If none, prompt the user for OAuth.
      const savedToken = getSavedGoogleCalendarToken();
      if (savedToken) {
        gapi.client.setToken({ access_token: savedToken });
        googleCalendarConnected = true;
        updateGoogleCalendarStatus();
        await syncGoogleCalendar();
        renderToday();
      } else {
        googleCalendarTokenClient.requestAccessToken({ prompt: '' });
      }
    } catch (err) {
      console.error('Google Calendar init failed', err);
      alert('Unable to initialize Google Calendar.');
    }
  }

  window.createGoogleCalendarEvent = createGoogleCalendarEvent;
  window.buildGoogleEventDateTime = buildGoogleEventDateTime;
  window.loadGoogleCalendar = loadGoogleCalendar;
  window.isGoogleCalendarConnected = isGoogleCalendarConnected;
  window.updateGoogleCalendarStatus = updateGoogleCalendarStatus;

  return { init };
})();

const GEMINI_MODEL = 'gemini-2.0-flash';
let geminiApiKeyPromise = null;

async function getGeminiApiKey() {
  if (geminiApiKeyPromise) return geminiApiKeyPromise;
  geminiApiKeyPromise = (async () => {
    const configKey = window.NAVIGUIDE_ENV?.GEMINI_API_KEY || window.NAVIGUIDE_ENV?.GOOGLE_MAPS_API_KEY;
    if (configKey) {
      Store.setApiKey(configKey);
      return configKey;
    }

    try {
      const res = await fetch('.env', { cache: 'no-store' });
      if (!res.ok) throw new Error('No local env file');
      const text = await res.text();
      const geminiKey = text.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
      const mapsKey = text.match(/^GOOGLE_MAPS_API_KEY=(.+)$/m)?.[1]?.trim();
      const key = geminiKey || mapsKey || '';
      if (key) Store.setApiKey(key);
      return key;
    } catch {
      return Store.getApiKey();
    }
  })();
  return geminiApiKeyPromise;
}

function buildSystemPrompt() {
  const stats = Store.getStats();
  const routes = Store.getFrequentRoutes().slice(0, 4);
  const today = Store.getLocalTodayDateString?.() || new Date().toISOString().split('T')[0];
  const todayEvents = Store.calendarEvents
    .filter(e => (e.date || '').split('T')[0] === today)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    .map(e => {
      const loc = e.loc || e.location;
      return `${e.time || 'All Day'} ${e.title}${loc ? ` @ ${loc}` : ''}`;
    })
    .join('; ') || 'No events yet';

  return `You are NaviGuide, a smart day planner for University of Washington (Seattle) students. The user has ${stats.count} trips logged, avg commute ${stats.avgDur} min, top routes: ${routes.map(r => `${r.from}→${r.to} (${r.count}x)`).join(', ') || 'none'}. Today's calendar: ${todayEvents}. Prefer UW campus locations (HUB, Red Square, Odegaard, Allen Center, IMA). Be helpful, specific, and concise. Use plain text unless JSON is requested.`;
}

window.buildSystemPrompt = buildSystemPrompt;

// Ask Gemini Flash using the stored AI API key.
async function askGeminiFlash(prompt, systemPrompt, maxOutputTokens = 400, options = {}) {
  const apiKey = await getGeminiApiKey();
  const generationConfig = {
    maxOutputTokens,
    temperature: options.temperature ?? 0.7
  };
  if (options.json) {
    generationConfig.responseMimeType = 'application/json';
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig
    })
  });

  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || 'Gemini request failed');

  return data.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('\n')
    .trim() || 'No response.';
}

// Send a prompt to Gemini Flash and render the response in the requested output panel.
async function askAI(outputId, prompt) {
  const apiKey = await getGeminiApiKey();
  const outEl = document.getElementById(outputId);
  if (!outEl) return;

  if (!apiKey) {
    outEl.classList.add('visible');
    outEl.innerHTML = `<strong>Add your Gemini API key</strong> to enable AI suggestions. Click the status indicator in the sidebar.`;
    showApiKeyPrompt();
    return;
  }

  outEl.classList.add('visible');
  outEl.innerHTML = `<div class="ai-loading"><div class="ai-spinner"></div>Thinking...</div>`;

  const dot = document.querySelector('.status-dot');
  const txt = document.querySelector('.status-text');
  dot.className = 'status-dot loading';
  txt.textContent = 'Asking AI...';

  const systemPrompt = buildSystemPrompt();

  try {
    if (window.AiPlanner && /\b(add|schedule|put|book|remind|meet|study|coffee|lunch|dinner|appointment)\b/i.test(prompt)) {
      const plan = await AiPlanner.planDayFromText(prompt);
      if (plan.intent === 'add_event' && plan.events?.length) {
        window._pendingAiEvents = plan.events;
        outEl.innerHTML = `${plan.message.replace(/\n/g, '<br>')}<br><br>${plan.events.map(e =>
          `<strong>${e.title}</strong> — ${e.time}${e.loc ? ` @ ${e.loc}` : ''}`
        ).join('<br>')}<br><br><button class="btn-primary" style="margin-top:8px" onclick="confirmAiPlanAdd()">Add to calendar</button>`;
        dot.className = 'status-dot';
        txt.textContent = 'AI ready';
        return;
      }
      if (plan.message) {
        outEl.innerHTML = plan.message.replace(/\n/g, '<br>');
        dot.className = 'status-dot';
        txt.textContent = 'AI ready';
        return;
      }
    }

    const text = await askGeminiFlash(prompt, systemPrompt, 400);
    outEl.innerHTML = text.replace(/\n/g, '<br>');

    dot.className = 'status-dot';
    txt.textContent = 'AI ready';
  } catch (err) {
    outEl.innerHTML = `<strong>Error:</strong> ${err.message}`;
    dot.className = 'status-dot error';
    txt.textContent = 'AI error';
  }
}

// Helper to submit an AI prompt from a text input field.
async function askAIFromInput(inputId, outputId) {
  const input = document.getElementById(inputId);
  if (!input || !input.value.trim()) return;
  const prompt = input.value.trim();
  input.value = '';
  await askAI(outputId, prompt);
}

async function confirmAiPlanAdd() {
  const events = window._pendingAiEvents;
  if (!events?.length || !window.AiPlanner) return;
  await AiPlanner.confirmPlannedEvents(events);
  window._pendingAiEvents = null;
  const out = document.getElementById('nl-add-out') || document.getElementById('today-ai-out');
  if (out) out.innerHTML = '<strong>Added to your calendar.</strong>';
}

window.confirmAiPlanAdd = confirmAiPlanAdd;

// Display a modal that lets the user enter or update the AI API key.
// Display a modal dialog for the user to enter an AI API key.
function showApiKeyPrompt() {
  const existing = document.getElementById('apikey-modal');
  if (existing) { existing.style.display = 'flex'; return; }

  const modal = document.createElement('div');
  modal.id = 'apikey-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r-lg);padding:24px;width:380px;font-family:var(--font-mono)">
      <div style="font-family:var(--font-head);font-size:16px;font-weight:600;margin-bottom:8px">Add your Gemini API key</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.6">Get a free key from <strong style="color:var(--accent)">aistudio.google.com/app/apikey</strong>. It's stored locally in your browser only.</div>
      <div class="key-input-row">
        <input type="password" id="modal-api-key" placeholder="AIza..." value="${Store.getApiKey()}" />
        <button class="btn-primary" onclick="saveApiKey()">Save</button>
      </div>
      <button class="btn-secondary" style="width:100%;margin-top:8px" onclick="document.getElementById('apikey-modal').style.display='none'">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);
}

// Save the user-entered API key and update the sidebar status.
function saveApiKey() {
  const key = document.getElementById('modal-api-key').value.trim();
  if (key) {
    Store.setApiKey(key);
    document.getElementById('apikey-modal').style.display = 'none';
    const dot = document.querySelector('.status-dot');
    const txt = document.querySelector('.status-text');
    dot.className = 'status-dot';
    txt.textContent = 'AI ready';
  }
}

document.querySelector('.api-status').addEventListener('click', showApiKeyPrompt);

document.addEventListener('DOMContentLoaded', App.init);

// loadGoogleCalendar is exposed via window.loadGoogleCalendar from the App IIFE above.