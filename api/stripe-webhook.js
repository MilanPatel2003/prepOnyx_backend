// Stripe Webhook endpoint for subscription events -> Firestore sync
const Stripe = require('stripe');
const admin = require('firebase-admin');
const getRawBody = require('raw-body');

// Initialize Firebase Admin with service account from env
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // Only allow POST
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // Get the raw body for Stripe signature verification
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    res.status(400).send('Invalid body');
    return;
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Handle event types as needed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // Example: Save session info to Firestore
    await db.collection('stripeSessions').doc(session.id).set(session);
  }

  // Respond to Stripe
  res.json({ received: true });
};


module.exports = async (req, res) => {
  // Stripe requires the raw body for webhook signature verification
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // Set CORS headers if needed
  res.setHeader('Access-Control-Allow-Origin', '*');

  const sig = req.headers['stripe-signature'];
  let event;
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    console.error('Error getting raw body:', err.message);
    return res.status(400).send(`Raw body error: ${err.message}`);
  }

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId, planId, planName } = session.metadata;
    const subscriptionId = session.subscription;

    // Update Firestore user document
    if (userId && planId) {
      await db.collection('users').doc(userId).set(
        {
          plan: planId,
          planName,
          subscriptionId,
          subscriptionStatus: 'active',
          updatedAt: new Date(),
        },
        { merge: true }
      );
    }
  }

  // TODO: Handle subscription.updated, subscription.deleted, etc.

  res.status(200).send('Received');
};

// Vercel config: disable default body parsing for raw body support
export const config = {
  api: {
    bodyParser: false,
  },
};
