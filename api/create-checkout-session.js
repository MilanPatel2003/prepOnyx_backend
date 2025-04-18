const Stripe = require('stripe');

module.exports = async (req, res) => {
  // CORS headers for all responses
  // Dynamically allow localhost and production frontend for CORS
  const allowedOrigins = ['http://localhost:5173', 'https://preponyx.web.app'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const frontendUrl = process.env.FRONTEND_URL;

  if (!stripeSecretKey || !frontendUrl) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  const stripe = Stripe(stripeSecretKey);
  const { planId, planName, priceId, userId, userEmail } = req.body;

  if (!planId || !planName || !priceId || !userId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `https://preponyx.web.app/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://preponyx.web.app/pricing`, // Redirect to pricing if payment is cancelled
      metadata: {
        planId,
        planName,
        userId,
      },
      billing_address_collection: 'required',
      locale: 'auto', // Automatically localizes the Checkout page to the user's browser language
      ...(userEmail && { customer_email: userEmail }), // Pre-fill customer email if provided
      // Note: For best branding, update logo, color, and business info in Stripe Dashboard > Settings > Branding
    }); // <-- If you deploy backend, update frontendUrl and ensure env vars are set accordingly
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
};