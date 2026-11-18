// GET /api/notams?icao=KJFK
// Free public NOTAMs for the Datum trip planner. No auth: the calculator is
// free, and so is this. Server-side proxy because the FAA NOTAM Search API
// is bot-gated (it returned 403 to direct requests from this VM, even with
// a browser User-Agent), and its CORS behaviour is unknown.
// Upstream: FAA NOTAM Search (notams.aim.faa.gov), no key.
// If the FAA source stays blocked from Vercel, the fallback is a free
// CheckWX API key (free tier) stored as a Vercel env var — not wired yet.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const icao = String((req.query && req.query.icao) || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{3,4}$/.test(icao)) return res.status(400).json({ error: 'Missing icao (e.g. ?icao=KJFK)' });

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
    const notams = (Array.isArray(list) ? list : []).map((n) => ({
      id: n.notamId || n.id || n.notamNumber || null,
      number: n.notamNumber || null,
      text: n.text || n.notamText || '',
      type: n.type || n.classification || null,
      start: n.effectiveStart || n.startTime || null,
      end: n.effectiveEnd || n.endTime || null,
      location: n.location || icao
    })).filter((n) => n.text);
    return res.status(200).json({ fetchedAt: new Date().toISOString(), icao, notams });
  } catch (e) {
    console.error('notams proxy failed', e);
    return res.status(502).json({ error: 'NOTAM source unavailable right now', icao });
  } finally {
    clearTimeout(t);
  }
};
