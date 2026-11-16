const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports.config = { api: { bodyParser: false } };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  let buf = Buffer.alloc(0);
  for await (const chunk of req) buf = Buffer.concat([buf, chunk]);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata && session.metadata.supabase_user_id;
    if (userId) {
      const update = {
        id: userId,
        is_paid: true,
        stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
        paid_at: new Date().toISOString()
      };
      const email = session.customer_email || (session.customer_details && session.customer_details.email);
      if (email) update.email = email;
      await supabase.from('profiles').upsert(update, { onConflict: 'id' });
    }
  }

  return res.status(200).json({ received: true });
};
