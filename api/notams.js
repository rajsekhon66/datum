// GET /api/notams?icao=KJFK
// Free public NOTAMs for the Datum trip planner. No auth: the calculator is
// free, and so is this. Server-side proxy because the FAA NOTAM Search API
// is bot-gated, and its CORS behaviour is unknown.
// Primary: FAA NOTAM Search (notams.aim.faa.gov), no key.
// Fallback: CheckWX (api.checkwx.com), free tier, needs CHECKWX_API_KEY
// (Vercel env var). CheckWX is Version 2: the path MUST be
// https://api.checkwx.com/v2/notam/<ICAO> — the unversioned path 404s.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

async function fetchFaa(icao) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch('https://notams.aim.faa.gov/notamSearch/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ searchType: 0, designatorsForLocation: icao }),
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error('FAA NOTAM HTTP ' + r.status);
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data.notamList || data.notams || []);
    return (Array.isArray(list) ? list : []).map((n) => ({
      id: n.notamId || n.id || n.notamNumber || null,
      number: n.notamNumber || null,
      text: n.text || n.notamText || '',
      type: n.type || n.classification || null,
      start: n.effectiveStart || n.startTime || null,
      end: n.effectiveEnd || n.endTime || null,
      location: n.location || icao
    })).filter((n) => n.text);
  } finally {
    clearTimeout(t);
  }
}

async function fetchCheckwx(icao) {
  const key = process.env.CHECKWX_API_KEY;
  if (!key) throw new Error('No CheckWX key configured');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch('https://api.checkwx.com/v2/notam/' + encodeURIComponent(icao), {
      headers: { 'X-API-Key': key, 'Accept': 'application/json' },
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error('CheckWX HTTP ' + r.status);
    const data = await r.json();
    const list = Array.isArray(data.data) ? data.data : [];
    return list.map((item) => {
      const text = typeof item === 'string' ? item : (item.raw || item.raw_text || item.text || item.notam || '');
      const m = text.match(/^\S+\s+(\d{2}\/\d{3})\b/);
      return { id: null, number: m ? m[1] : null, text, type: null, start: null, end: null, location: icao };
    }).filter((n) => n.text);
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const icao = String((req.query && req.query.icao) || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{3,4}$/.test(icao)) return res.status(400).json({ error: 'Missing icao (e.g. ?icao=KJFK)' });

  try {
    const notams = await fetchFaa(icao);
    return res.status(200).json({ fetchedAt: new Date().toISOString(), icao, source: 'faa', notams });
  } catch (faaErr) {
    console.error('notams FAA failed, trying CheckWX', faaErr);
    try {
      const notams = await fetchCheckwx(icao);
      return res.status(200).json({ fetchedAt: new Date().toISOString(), icao, source: 'checkwx', notams });
    } catch (e) {
      console.error('notams CheckWX failed', e);
      return res.status(502).json({ error: 'NOTAM source unavailable right now', icao });
    }
  }
};
