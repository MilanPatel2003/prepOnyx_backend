const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const { customerId, returnUrl } = req.body;
  if (!customerId || !returnUrl) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
