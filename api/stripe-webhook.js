const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports.config = { api: { bodyParser: false } };

// Set is_paid for the profile that owns a Stripe customer id.
// Used by the school-subscription events; the profile is found by the
// stripe_customer_id stored at checkout completion.
async function setPaidByCustomer(customerId, isPaid) {
  if (!customerId) return;
  const id = typeof customerId === 'string' ? customerId : customerId.id;
  if (!id) return;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', id)
    .single();
  if (!profile) return;
  await supabase.from('profiles').update({ is_paid: isPaid }).eq('id', profile.id);
}

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

  // School subscriptions ($99/year): keep is_paid in step with the
  // subscription's status. The webhook endpoint must be subscribed to
  // customer.subscription.updated and customer.subscription.deleted in
  // the Stripe Dashboard, in addition to checkout.session.completed.
  // past_due stays paid (Stripe retries the renewal); a subscription that
  // ends, fails outright, or is cancelled loses access.
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    const live = ['active', 'trialing', 'past_due'].includes(sub.status);
    await setPaidByCustomer(sub.customer, live);
  }
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await setPaidByCustomer(sub.customer, false);
  }

  return res.status(200).json({ received: true });
};
