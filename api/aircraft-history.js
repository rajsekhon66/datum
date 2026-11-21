// GET /api/aircraft-history?reg=N333UM
// Aircraft history for Datum: NTSB investigations, FAA accident/incident
// reports, Service Difficulty Reports, and the count of ADs / advisory
// bulletins that may apply to the model, for one US tail number.
// No auth, no key. Server-side fetch because the browser cannot rely on
// the upstream sending CORS headers.
// Upstream: OpenAirDocs (openairdocs.org), an open public-domain mirror of
// FAA + NTSB public data. One HTTPS GET of the aircraft's Markdown page
// (https://openairdocs.org/aircraft/<REG>.md); the sections below are
// parsed out of it. AD counts are model-level ("may apply"), NOT a
// compliance determination for this airframe. SDRs are voluntary for
// privately owned Part 91 aircraft, so an empty SDR list is not proof of
// a clean maintenance history. N-numbers are reused, so records are
// matched by OpenAirDocs against serial number / make / model as well.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

async function fetchText(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('Upstream HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

// List items look like: - [NTSB ANC26FA077](https://openairdocs.org/ntsb/ANC26FA077), Jul 28, 2026: Piper PA22 ...
function parseItems(sectionText) {
  const items = [];
  String(sectionText || '').split('\n').forEach((ln) => {
    const m = ln.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*,?\s*(.*)$/);
    if (m) items.push({ label: m[1], url: m[2], text: (m[3] || '').trim() });
  });
  return items;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = String((req.query && req.query.reg) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^N[0-9A-Z]{1,5}$/.test(raw)) return res.status(400).json({ error: 'Missing reg (e.g. ?reg=N333UM)' });

  const pageUrl = 'https://openairdocs.org/aircraft/' + raw;
  try {
    const md = await fetchText(pageUrl + '.md', 10000);

    // Split into ## sections, keyed by heading text.
    const sections = {};
    let cur = null;
    md.split('\n').forEach((ln) => {
      const h = ln.match(/^##\s+(.+?)\s*$/);
      if (h) { cur = h[1]; sections[cur] = []; return; }
      if (cur) sections[cur].push(ln);
    });
    const findSection = (re) => {
      for (const k in sections) if (re.test(k)) return { title: k, body: sections[k].join('\n') };
      return null;
    };
    const itemsOf = (sec) => {
      if (!sec) return [];
      if (/None matched|None filed/i.test(sec.body)) return [];
      return parseItems(sec.body);
    };
    const countInTitle = (sec) => {
      if (!sec) return 0;
      const m = sec.title.match(/(\d+)\s+in force/);
      return m ? parseInt(m[1], 10) : 0;
    };

    const titleLine = (md.split('\n')[0] || '');
    const notRegistered = /not currently registered/i.test(titleLine);

    return res.status(200).json({
      reg: raw,
      pageUrl,
      registered: !notRegistered,
      fetchedAt: new Date().toISOString(),
      ntsb: itemsOf(findSection(/NTSB/i)),
      faa: itemsOf(findSection(/FAA accident/i)),
      sdr: itemsOf(findSection(/Service difficulty/i)),
      adCount: countInTitle(findSection(/ADs that may apply/i)),
      saibCount: countInTitle(findSection(/Information bulletins/i))
    });
  } catch (e) {
    console.error('aircraft-history proxy failed', e && e.message);
    if (e && /HTTP 404/.test(e.message)) return res.status(404).json({ error: 'No history page for ' + raw });
    return res.status(502).json({ error: 'History source unavailable right now' });
  }
};
