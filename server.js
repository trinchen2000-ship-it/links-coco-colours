const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || 'coco-geheim-2024';

// ========== DATABASE ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      session_id VARCHAR(64),
      event_type VARCHAR(80),
      event_data JSONB DEFAULT '{}',
      ip_address VARCHAR(45),
      city VARCHAR(120),
      country VARCHAR(80),
      country_code VARCHAR(4),
      region VARCHAR(120),
      device VARCHAR(20),
      browser VARCHAR(80),
      referrer TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_city ON events(city);
  `);
  console.log('[DB] Tabelle bereit.');
}

// ========== MIDDLEWARE ==========
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10kb' }));

// ========== HELPERS ==========
const geoCache = new Map();

async function getGeo(ip) {
  const clean = (ip || '').replace('::ffff:', '').split(',')[0].trim();
  if (!clean || clean === '127.0.0.1' || clean === '::1') {
    return { city: 'Lokal', country: 'Deutschland', country_code: 'DE', region: '' };
  }
  if (geoCache.has(clean)) return geoCache.get(clean);
  try {
    const r = await fetch(
      `http://ip-api.com/json/${clean}?fields=city,country,countryCode,regionName&lang=de`,
      { timeout: 3000 }
    );
    const d = await r.json();
    const geo = { city: d.city || '?', country: d.country || '?', country_code: d.countryCode || '', region: d.regionName || '' };
    geoCache.set(clean, geo);
    if (geoCache.size > 1000) geoCache.delete(geoCache.keys().next().value);
    return geo;
  } catch {
    return { city: '?', country: '?', country_code: '', region: '' };
  }
}

function getDevice(ua = '') {
  if (/iPad|tablet/i.test(ua)) return 'tablet';
  if (/iPhone|Android|Mobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function getBrowser(ua = '') {
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  if (/Opera|OPR/i.test(ua)) return 'Opera';
  return 'Andere';
}

// ========== LANDING PAGE ==========
// public/index.html wird automatisch auf / ausgeliefert
app.use(express.static(path.join(__dirname, 'public')));

// ========== TRACKING ENDPOINT ==========
app.post('/track', async (req, res) => {
  res.status(200).json({ ok: true }); // immer sofort antworten

  try {
    const { event_type, event_data = {}, session_id, referrer } = req.body;
    const ua = req.headers['user-agent'] || '';
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const geo = await getGeo(ip); // IP nur für Geo, dann verwerfen

    await pool.query(
      `INSERT INTO events
        (session_id, event_type, event_data, city, country, country_code, region, device, browser, referrer, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        session_id || null,
        event_type || 'unknown',
        JSON.stringify(event_data),
        geo.city,
        geo.country,
        geo.country_code,
        geo.region,
        getDevice(ua),
        getBrowser(ua),
        referrer || null,
        ua.slice(0, 300),
      ]
    );
  } catch (err) {
    console.error('[Track]', err.message);
  }
});

// ========== DASHBOARD ==========
const EVENT_LABELS = {
  pageview:          '👁  Seitenaufruf',
  click_link:        '🔗 Link geklickt',
  click_social:      '📸 Social geklickt',
  berater_start:     '🔮 Berater gestartet',
  berater_path:      '🎯 Berater Pfad',
  berater_tradition: '⚡ Tradition gewählt',
  berater_meaning:   '💫 Bedeutung gewählt',
  berater_result:    '✅ Berater Ergebnis',
  slot_spin:         '🎰 Slot Machine',
  rechner:           '📐 Größen-Rechner',
  search:            '🔍 Symbol Suche',
  pflege_tab:        '🩹 Pflege Tab',
  tool_open:         '🔧 Tool geöffnet',
  popup_close:       '✕  Popup geschlossen',
};

app.get('/dashboard', async (req, res) => {
  if (req.query.token !== DASHBOARD_TOKEN) {
    return res.status(403).send('<h2 style="font-family:sans-serif;padding:40px">Zugriff verweigert.</h2>');
  }

  try {
    const [
      totRow, todayRow, weekRow,
      cities, evTypes, devices, browsers,
      recent, hourly, daily,
      links, socials, traditions, meanings, searches,
      topSessions,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM events`),
      pool.query(`SELECT COUNT(*) FROM events WHERE created_at > NOW()-INTERVAL'24 hours'`),
      pool.query(`SELECT COUNT(DISTINCT session_id) FROM events WHERE created_at > NOW()-INTERVAL'7 days'`),

      pool.query(`SELECT city, country, country_code, COUNT(*) cnt FROM events
                  WHERE city IS NOT NULL AND city NOT IN ('Lokal','?')
                  GROUP BY city,country,country_code ORDER BY cnt DESC LIMIT 15`),

      pool.query(`SELECT event_type, COUNT(*) cnt FROM events GROUP BY event_type ORDER BY cnt DESC`),
      pool.query(`SELECT device, COUNT(*) cnt FROM events GROUP BY device ORDER BY cnt DESC`),
      pool.query(`SELECT browser, COUNT(*) cnt FROM events GROUP BY browser ORDER BY cnt DESC LIMIT 6`),

      pool.query(`SELECT id,created_at,event_type,event_data,city,country,device,browser
                  FROM events ORDER BY created_at DESC LIMIT 80`),

      pool.query(`SELECT EXTRACT(HOUR FROM created_at) h, COUNT(*) cnt
                  FROM events WHERE created_at > NOW()-INTERVAL'24 hours'
                  GROUP BY h ORDER BY h`),

      pool.query(`SELECT DATE(created_at) AS tag,
                    COUNT(DISTINCT session_id) AS sessions,
                    COUNT(*) AS events
                  FROM events WHERE created_at > NOW()-INTERVAL'30 days'
                  GROUP BY tag ORDER BY tag DESC LIMIT 30`),

      pool.query(`SELECT event_data->>'link' link, event_data->>'text' txt, COUNT(*) cnt
                  FROM events WHERE event_type='click_link'
                  GROUP BY link,txt ORDER BY cnt DESC LIMIT 10`),

      pool.query(`SELECT event_data->>'platform' platform, COUNT(*) cnt
                  FROM events WHERE event_type='click_social'
                  GROUP BY platform ORDER BY cnt DESC`),

      pool.query(`SELECT event_data->>'tradition' v, COUNT(*) cnt
                  FROM events WHERE event_type='berater_tradition'
                  AND event_data->>'tradition' IS NOT NULL
                  GROUP BY v ORDER BY cnt DESC LIMIT 12`),

      pool.query(`SELECT event_data->>'meaning' v, COUNT(*) cnt
                  FROM events WHERE event_type='berater_meaning'
                  AND event_data->>'meaning' IS NOT NULL
                  GROUP BY v ORDER BY cnt DESC LIMIT 12`),

      pool.query(`SELECT event_data->>'query' q, COUNT(*) cnt
                  FROM events WHERE event_type='search'
                  AND LENGTH(event_data->>'query') > 1
                  GROUP BY q ORDER BY cnt DESC LIMIT 20`),

      pool.query(`SELECT session_id, COUNT(*) cnt, MIN(created_at) first, MAX(created_at) last,
                    MAX(city) city, MAX(device) device
                  FROM events
                  WHERE session_id IS NOT NULL AND created_at > NOW()-INTERVAL'7 days'
                  GROUP BY session_id ORDER BY cnt DESC LIMIT 10`),
    ]);

    res.send(buildDashboard({
      total: totRow.rows[0].count,
      today: todayRow.rows[0].count,
      weekSessions: weekRow.rows[0].count,
      cities: cities.rows,
      evTypes: evTypes.rows,
      devices: devices.rows,
      browsers: browsers.rows,
      recent: recent.rows,
      hourly: hourly.rows,
      daily: daily.rows,
      links: links.rows,
      socials: socials.rows,
      traditions: traditions.rows,
      meanings: meanings.rows,
      searches: searches.rows,
      topSessions: topSessions.rows,
    }));
  } catch (err) {
    console.error('[Dashboard]', err);
    res.status(500).send('DB Fehler: ' + err.message);
  }
});

// ========== DASHBOARD HTML ==========
function buildDashboard(d) {
  const fmt = ts => new Date(ts).toLocaleString('de-DE', {
    day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
  });
  const fmtDay = ts => new Date(ts).toLocaleDateString('de-DE', {
    weekday:'short', day:'2-digit', month:'2-digit'
  });

  const hourlyArr = Array.from({length:24}, (_,h) => {
    const r = d.hourly.find(x => parseInt(x.h) === h);
    return r ? parseInt(r.cnt) : 0;
  });
  const maxH = Math.max(...hourlyArr, 1);

  const bar = (label, cnt, max, color='gold', extra='') => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">
      <div style="min-width:160px;font-size:12px;color:#f0ede8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
      <div style="flex:1;height:5px;background:#1e1e1e;border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${Math.round(cnt/max*100)}%;background:${color==='gold'?'#c9a84c':'#2ecfb8'};border-radius:3px"></div>
      </div>
      <div style="font-size:11px;color:#666;min-width:30px;text-align:right">${cnt}${extra}</div>
    </div>`;

  const card = (title, content, style='') =>
    `<div style="background:#141414;border:1px solid #222;border-radius:12px;padding:18px 20px;${style}">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#555;margin-bottom:14px;font-weight:500">${title}</div>
      ${content}
    </div>`;

  const statCard = (label, value, sub='') =>
    `<div style="background:#141414;border:1px solid #222;border-radius:12px;padding:18px 20px">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#555;margin-bottom:8px">${label}</div>
      <div style="font-size:32px;font-weight:500;color:#c9a84c;line-height:1">${value}</div>
      ${sub ? `<div style="font-size:11px;color:#555;margin-top:4px">${sub}</div>` : ''}
    </div>`;

  const maxEv = Math.max(...d.evTypes.map(r=>parseInt(r.cnt)), 1);
  const maxCity = Math.max(...d.cities.map(r=>parseInt(r.cnt)), 1);
  const maxLink = Math.max(...d.links.map(r=>parseInt(r.cnt)), 1);
  const maxTrad = Math.max(...d.traditions.map(r=>parseInt(r.cnt)), 1);
  const maxMean = Math.max(...d.meanings.map(r=>parseInt(r.cnt)), 1);

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coco Colours · Analytics</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#f0ede8;font-family:system-ui,-apple-system,sans-serif;font-size:14px;padding:28px 20px 80px;max-width:1280px;margin:0 auto}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.g1{margin-bottom:16px}
.section-title{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#444;margin:24px 0 12px;padding-bottom:8px;border-bottom:1px solid #1a1a1a}
.pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;background:rgba(201,168,76,.1);color:#c9a84c;border:1px solid rgba(201,168,76,.2);margin:2px}
.pill.teal{background:rgba(46,207,184,.1);color:#2ecfb8;border-color:rgba(46,207,184,.2)}
.feed-row{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #181818;align-items:flex-start}
.feed-row:last-child{border:none}
.feed-time{font-size:10px;color:#444;white-space:nowrap;padding-top:1px;min-width:76px}
.feed-body{flex:1;min-width:0}
.feed-type{font-size:12px;color:#f0ede8;margin-bottom:1px}
.feed-data{font-size:11px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.feed-loc{font-size:10px;color:#2ecfb8;margin-top:1px}
.badge{display:inline-block;padding:1px 5px;border-radius:4px;font-size:10px;background:#1e1e1e;color:#555;margin-left:5px}
.hour-bar{transition:opacity .2s}
.hour-bar:hover{opacity:.7}
@media(max-width:800px){.g4{grid-template-columns:1fr 1fr}.g3{grid-template-columns:1fr 1fr}.g2{grid-template-columns:1fr}}
@media(max-width:500px){.g4{grid-template-columns:1fr}.g3{grid-template-columns:1fr}}
</style>
</head>
<body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;flex-wrap:wrap;gap:12px">
  <div>
    <div style="font-size:20px;font-weight:500;letter-spacing:2px;color:#f0ede8;margin-bottom:3px">🖤 COCO COLOURS</div>
    <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#444">Analytics · links.coco-colours.de</div>
  </div>
  <div style="display:flex;gap:8px;align-items:center">
    <div style="font-size:11px;color:#444">Aktualisiert: ${new Date().toLocaleString('de-DE')}</div>
    <button onclick="location.reload()" style="padding:8px 14px;background:#141414;border:1px solid #222;color:#666;border-radius:8px;cursor:pointer;font-size:12px">↻ Reload</button>
  </div>
</div>

<!-- STATS -->
<div class="g4">
  ${statCard('Events gesamt', parseInt(d.total).toLocaleString('de-DE'))}
  ${statCard('Letzte 24h', d.today, 'Events')}
  ${statCard('Sessions (7 Tage)', d.weekSessions, 'Unique Besucher')}
  ${statCard('Top Stadt', d.cities[0]?.city || '–', d.cities[0] ? d.cities[0].cnt + ' Events' : '')}
</div>

<!-- STÄDTE + EVENTS -->
<div class="section-title">Woher kommen deine Besucher</div>
<div class="g2">
  ${card('Top Städte', d.cities.length === 0
    ? '<p style="color:#444;font-size:12px">Noch keine Daten</p>'
    : d.cities.map(r => bar(`${r.city}, ${r.country}`, r.cnt, maxCity)).join('')
  )}
  ${card('Was passiert auf der Seite', d.evTypes.map(r =>
    bar(EVENT_LABELS[r.event_type] || r.event_type, r.cnt, maxEv, 'teal')
  ).join(''))}
</div>

<!-- 30 TAGE VERLAUF -->
<div class="section-title">Verlauf letzte 30 Tage</div>
${card('Sessions & Events pro Tag', `
  <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="color:#444;text-align:left">
          <th style="padding:4px 8px 10px 0;font-weight:400;border-bottom:1px solid #1e1e1e">Tag</th>
          <th style="padding:4px 8px 10px;font-weight:400;border-bottom:1px solid #1e1e1e;text-align:right">Sessions</th>
          <th style="padding:4px 8px 10px;font-weight:400;border-bottom:1px solid #1e1e1e;text-align:right">Events</th>
        </tr>
      </thead>
      <tbody>
        ${d.daily.map(r => `
          <tr style="border-bottom:1px solid #161616">
            <td style="padding:6px 8px 6px 0;color:#888">${fmtDay(r.tag)}</td>
            <td style="padding:6px 8px;color:#c9a84c;text-align:right">${r.sessions}</td>
            <td style="padding:6px 8px;color:#555;text-align:right">${r.events}</td>
          </tr>`).join('')}
        ${d.daily.length === 0 ? '<tr><td colspan="3" style="color:#444;padding:12px 0;font-size:12px">Noch keine Daten</td></tr>' : ''}
      </tbody>
    </table>
  </div>
`)}

<!-- HEUTE STÜNDLICH -->
<div class="section-title">Heute — Aktivität nach Stunde</div>
${card('Events pro Stunde (letzte 24h)', `
  <div style="display:flex;align-items:flex-end;gap:3px;height:64px;padding-bottom:0">
    ${hourlyArr.map((cnt, h) => `
      <div class="hour-bar" title="${cnt} Events · ${h}:00 Uhr"
        style="flex:1;min-width:0;background:${cnt>0?'#c9a84c':'#1a1a1a'};border-radius:2px 2px 0 0;
        height:${Math.max(cnt/maxH*100,cnt>0?4:1)}%;opacity:${cnt>0?0.85:0.3}"></div>
    `).join('')}
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:9px;color:#333">
    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
  </div>
`)}

<!-- TATTOO-BERATER -->
<div class="section-title">Tattoo-Berater Auswertung</div>
<div class="g3">
  ${card('Gewählte Traditionen', d.traditions.length === 0
    ? '<p style="color:#444;font-size:12px">Noch keine Daten</p>'
    : d.traditions.map(r => bar(r.v, r.cnt, maxTrad, 'teal')).join('')
  )}
  ${card('Gewählte Bedeutungen', d.meanings.length === 0
    ? '<p style="color:#444;font-size:12px">Noch keine Daten</p>'
    : d.meanings.map(r => bar(r.v, r.cnt, maxMean)).join('')
  )}
  ${card('Symbol-Suchen', d.searches.length === 0
    ? '<p style="color:#444;font-size:12px">Noch keine Suchen</p>'
    : d.searches.map(r => `<span class="pill">${r.q} (${r.cnt})</span>`).join('')
  )}
</div>

<!-- LINKS + SOCIAL -->
<div class="section-title">Klicks & Social</div>
<div class="g2">
  ${card('Geklickte Links', d.links.length === 0
    ? '<p style="color:#444;font-size:12px">Noch keine Daten</p>'
    : d.links.map(r => bar(
        (r.txt || r.link || '?').slice(0, 40),
        r.cnt, maxLink
      )).join('')
  )}
  ${card('Geräte & Browser', `
    <div style="margin-bottom:14px">
      ${d.devices.map(r => {
        const icons = {mobile:'📱', desktop:'💻', tablet:'📟'};
        const maxD = Math.max(...d.devices.map(x=>parseInt(x.cnt)), 1);
        return bar(`${icons[r.device]||''} ${r.device}`, r.cnt, maxD);
      }).join('')}
    </div>
    <div style="height:1px;background:#1e1e1e;margin-bottom:14px"></div>
    ${d.browsers.map(r => {
      const maxB = Math.max(...d.browsers.map(x=>parseInt(x.cnt)), 1);
      return bar(r.browser, r.cnt, maxB, 'teal');
    }).join('')}
  `)}
</div>

<!-- TOP SESSIONS -->
<div class="section-title">Aktivste Sessions (letzte 7 Tage)</div>
${card('Meiste Events pro Besucher', `
  <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="color:#444">
          <th style="padding:4px 8px 10px 0;font-weight:400;border-bottom:1px solid #1e1e1e;text-align:left">Session</th>
          <th style="padding:4px 8px 10px;font-weight:400;border-bottom:1px solid #1e1e1e;text-align:right">Events</th>
          <th style="padding:4px 8px 10px;font-weight:400;border-bottom:1px solid #1e1e1e;text-align:left">Stadt</th>
          <th style="padding:4px 8px 10px;font-weight:400;border-bottom:1px solid #1e1e1e;text-align:left">Gerät</th>
          <th style="padding:4px 8px 10px;font-weight:400;border-bottom:1px solid #1e1e1e;text-align:left">Zeitraum</th>
        </tr>
      </thead>
      <tbody>
        ${d.topSessions.map(r => `
          <tr style="border-bottom:1px solid #161616">
            <td style="padding:6px 8px 6px 0;color:#444;font-size:10px;font-family:monospace">${r.session_id?.slice(-8)||'?'}</td>
            <td style="padding:6px 8px;color:#c9a84c;text-align:right;font-weight:500">${r.cnt}</td>
            <td style="padding:6px 8px;color:#888">${r.city||'?'}</td>
            <td style="padding:6px 8px;color:#555">${r.device||'?'}</td>
            <td style="padding:6px 8px;color:#333;font-size:10px">${fmt(r.first)} – ${fmt(r.last)}</td>
          </tr>`).join('')}
        ${d.topSessions.length === 0 ? '<tr><td colspan="5" style="color:#444;padding:12px 0">Noch keine Sessions</td></tr>' : ''}
      </tbody>
    </table>
  </div>
`)}

<!-- LIVE FEED -->
<div class="section-title">Live Feed — letzte 80 Events</div>
${card('', `
  ${d.recent.map(r => {
    const label = EVENT_LABELS[r.event_type] || r.event_type;
    const ed = r.event_data || {};
    const details = Object.entries(ed)
      .filter(([k]) => !['session_id','page'].includes(k))
      .map(([k,v]) => `${k}: ${String(v).slice(0,60)}`)
      .join(' · ');
    return `<div class="feed-row">
      <div class="feed-time">${fmt(r.created_at)}</div>
      <div class="feed-body">
        <div class="feed-type">${label}<span class="badge">${r.device||''}</span><span class="badge">${r.browser||''}</span></div>
        ${details ? `<div class="feed-data">${details}</div>` : ''}
        ${r.city ? `<div class="feed-loc">📍 ${r.city}, ${r.country}</div>` : ''}
      </div>
    </div>`;
  }).join('')}
  ${d.recent.length === 0 ? '<p style="color:#444;font-size:12px;padding:20px 0">Noch keine Events. Öffne links.coco-colours.de im Browser!</p>' : ''}
`)}

</body>
</html>`;
}

app.get('/berater', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'berater.html'));
});

// ========== HEALTH ==========
app.get('/health', (req, res) => res.json({ ok: true, service: 'links.coco-colours.de' }));

// ========== START ==========
initDB()
  .then(() => app.listen(PORT, () => console.log(`[Server] läuft auf Port ${PORT}`)))
  .catch(err => { console.error('[DB Init]', err); process.exit(1); });
