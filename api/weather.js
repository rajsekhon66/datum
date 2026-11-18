// GET /api/weather?icao=KJFK,KMIA
// Free public weather for the Datum trip planner. No auth: the calculator is
// free, and so is this. Server-side proxy because aviationweather.gov sends
// no CORS headers, so the browser cannot call it directly.
// Upstream: NWS Aviation Weather Center (aviationweather.gov), no key.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('AWC HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = String((req.query && req.query.icao) || '').toUpperCase();
  const icaos = raw.split(',').map(s => s.trim()).filter(s => /^[A-Z0-9]{3,4}$/.test(s)).slice(0, 10);
  if (!icaos.length) return res.status(400).json({ error: 'Missing icao (e.g. ?icao=KJFK,KMIA)' });
  const ids = icaos.join(',');

  try {
    const [metar, taf] = await Promise.all([
      fetchJson('https://aviationweather.gov/api/data/metar?ids=' + encodeURIComponent(ids) + '&format=json'),
      fetchJson('https://aviationweather.gov/api/data/taf?ids=' + encodeURIComponent(ids) + '&format=json')
    ]);
    const byStation = (list) => {
      const out = {};
      (Array.isArray(list) ? list : []).forEach((rec) => {
        if (rec && rec.icaoId) out[rec.icaoId] = rec;
      });
      return out;
    };
    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      icao: icaos,
      metar: byStation(metar),
      taf: byStation(taf)
    });
  } catch (e) {
    console.error('weather proxy failed', e);
    return res.status(502).json({ error: 'Weather source unavailable right now' });
  }
};
