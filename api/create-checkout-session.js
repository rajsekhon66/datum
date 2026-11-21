const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_paid')
    .eq('id', user.id)
    .single();
  // Any paid account (individual one-time or active school subscription) is
  // already registered; the frontend does not offer a second purchase.
  // (An individual-paid user who wants to switch to a school plan needs
  // support to arrange it — not offered in-app in v1.)
  if (profile && profile.is_paid) return res.status(200).json({ already_paid: true });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const plan = body.plan || 'individual';

  let price, mode, successUrl;
  if (plan === 'school') {
    price = process.env.STRIPE_SCHOOL_PRICE_ID;
    if (!price) return res.status(500).json({ error: 'School price is not configured' });
    mode = 'subscription';
    successUrl = 'https://datumwb.app/?registered=success&plan=school';
  } else {
    price = process.env.STRIPE_PRICE_ID;
    mode = 'payment';
    successUrl = 'https://datumwb.app/?registered=success';
  }

  const session = await stripe.checkout.sessions.create({
    mode,
    line_items: [{ price, quantity: 1 }],
    customer_email: user.email,
    metadata: { supabase_user_id: user.id, plan },
    success_url: successUrl,
    cancel_url: 'https://datumwb.app/?registered=cancelled'
  });

  return res.status(200).json({ url: session.url });
};
