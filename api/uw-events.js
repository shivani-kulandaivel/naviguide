// Vercel/Netlify serverless: fetch UW Trumba RSS and return normalized JSON.
const TRUMBA_RSS = 'https://www.trumba.com/calendars/sea_campus.rss';

function stripTags(html) {
  return String(html || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseRssItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < 80) {
    const block = m[1];
    const pick = tag => {
      const t = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return t ? decodeEntities(stripTags(t[1])) : '';
    };
    const title = pick('title');
    if (!title) continue;
    const link = pick('link');
    const description = pick('description');
    const pubDate = pick('pubDate');
    const guid = pick('guid') || link || title;

    let date = '';
    let time = 'All Day';
    let loc = null;

    if (pubDate) {
      const d = new Date(pubDate);
      if (!Number.isNaN(d.getTime())) {
        date = d.toISOString().split('T')[0];
        time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      }
    }

    const locMatch = description.match(/(?:Location|Where):\s*([^\n<]+)/i)
      || description.match(/at\s+([A-Z][^.<]{4,60})/);
    if (locMatch) loc = locMatch[1].trim();

    const tags = [];
    const lower = `${title} ${description}`.toLowerCase();
    if (/dawg\s*daze|dawg\s*days|welcome week|orientation/i.test(lower)) {
      tags.push('dawg-daze');
    }
    if (/club|rs.o|student org/i.test(lower)) tags.push('club');

    items.push({
      externalId: `trumba:${guid}`.slice(0, 120),
      date,
      time,
      title,
      loc: loc || 'University of Washington, Seattle',
      url: link || 'https://www.trumba.com/events-calendar/wa/seattle/sea_campus',
      source: 'uw',
      tags: tags.length ? tags : ['campus']
    });
  }
  return items;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const rssRes = await fetch(TRUMBA_RSS, {
      headers: { 'User-Agent': 'NaviGuide-UW-Events/1.0' }
    });
    if (!rssRes.ok) throw new Error(`Trumba RSS ${rssRes.status}`);
    const xml = await rssRes.text();
    const events = parseRssItems(xml).filter(e => e.date);
    return res.status(200).json({ events, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message, events: [] });
  }
};
