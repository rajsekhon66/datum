const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

async function getUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return error ? null : user;
}

async function isPaid(userId) {
  const { data } = await supabase.from('profiles').select('is_paid').eq('id', userId).single();
  return !!(data && data.is_paid);
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });
  if (!(await isPaid(user.id))) return res.status(403).json({ error: 'Registration required' });

  if (req.method === 'GET') {
    // GET /api/loadsheets?id=<id> returns one sheet's data; GET without id lists them.
    if (req.query && req.query.id) {
      const { data, error } = await supabase
        .from('saved_loadsheets')
        .select('id, name, data, created_at, updated_at')
        .eq('id', req.query.id)
        .eq('user_id', user.id)
        .single();
      if (error || !data) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ loadsheet: data });
    }
    const { data, error } = await supabase
      .from('saved_loadsheets')
      .select('id, name, created_at, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ loadsheets: data });
  }

  if (req.method === 'POST') {
    const { name, data: sheetData } = req.body || {};
    if (!name || !sheetData) return res.status(400).json({ error: 'Missing name or data' });
    const { data, error } = await supabase
      .from('saved_loadsheets')
      .insert({ user_id: user.id, name: String(name).slice(0, 100), data: sheetData })
      .select('id')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ id: data.id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
