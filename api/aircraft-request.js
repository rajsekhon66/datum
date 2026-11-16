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

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Sign in required' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_paid')
    .eq('id', user.id)
    .single();
  if (!(profile && profile.is_paid)) return res.status(403).json({ error: 'Registration required' });

  const { aircraft } = req.body || {};
  if (!aircraft || !String(aircraft).trim()) return res.status(400).json({ error: 'Missing aircraft' });

  const { error: insErr } = await supabase
    .from('aircraft_requests')
    .insert({ user_id: user.id, aircraft: String(aircraft).trim().slice(0, 200) });
  if (insErr) return res.status(500).json({ error: insErr.message });

  return res.status(200).json({ ok: true });
};
