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
  // Centralized plan and mapping logic
  const plans = [
    {
      id: 'free',
      name: 'Free',
      features: [
        { feature: 'mockInterview', limit: 2 },
        { feature: 'pdfAnalyze', limit: 5 },
        { feature: 'skribbleAI', limit: 'unlimited' }
      ]
    },
    {
      id: 'premium',
      name: 'Premium',
      features: [
        { feature: 'mockInterview', limit: 10 },
        { feature: 'pdfAnalyze', limit: 25 },
        { feature: 'skribbleAI', limit: 'unlimited' }
      ]
    },
    {
      id: 'pro',
      name: 'Pro',
      features: [
        { feature: 'mockInterview', limit: 'unlimited' },
        { feature: 'pdfAnalyze', limit: 'unlimited' },
        { feature: 'skribbleAI', limit: 'unlimited' }
      ]
    }
  ];
  const priceIdToPlanId = {
    'price_1REom3SDRUk0pjjIaFkMgS5A': 'premium',
    'price_1REonDSDRUk0pjjI1KtZrCJO': 'premium',
    'price_1REop5SDRUk0pjjIHIrb7U5e': 'pro',
    'price_1REoodSDRUk0pjjIIFNczrWQ': 'pro',
  };
  function getPlanById(planId) {
    return plans.find(plan => plan.id === planId) || plans[0];
  }
  function getFeatureLimits(plan) {
    const limits = {};
    plan.features.forEach(f => { limits[f.feature] = f.limit; });
    return limits;
  }

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId } = session.metadata || {};
    const subscriptionId = session.subscription;
    // Try to get priceId from session
    const priceId = session?.metadata?.priceId || session?.display_items?.[0]?.price?.id || session?.items?.[0]?.price?.id || session?.subscription?.items?.data?.[0]?.price?.id;
    const mappedPlanId = priceIdToPlanId[priceId] || session.metadata?.planId || 'free';
    const plan = getPlanById(mappedPlanId);
    const featureLimits = getFeatureLimits(plan);
    if (userId) {
      await db.collection('users').doc(userId).set(
        {
          plan: plan.id,
          planName: plan.name,
          subscriptionId,
          subscriptionStatus: 'active',
          updatedAt: new Date(),
          featureLimits,
          usageHistory: [],
        },
        { merge: true }
      );
      console.log(`[WEBHOOK] User ${userId} upgraded to plan ${plan.id}`);
    } else {
      console.warn('[WEBHOOK] No userId in session.metadata');
    }
  }

  // Handle subscription updates (renewal, status changes)
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId;
    // Get priceId from subscription
    const priceId = subscription.items?.data?.[0]?.price?.id;
    const mappedPlanId = priceIdToPlanId[priceId] || 'free';
    const plan = getPlanById(mappedPlanId);
    const featureLimits = getFeatureLimits(plan);
    const subscriptionStatus = subscription.status;
    if (userId) {
      let updates = {
        subscriptionStatus,
        updatedAt: new Date(),
      };
      if (subscriptionStatus === 'active') {
        updates.plan = plan.id;
        updates.planName = plan.name;
        updates.featureLimits = featureLimits;
      }
      if (subscriptionStatus === 'canceled' || subscriptionStatus === 'unpaid' || subscriptionStatus === 'incomplete_expired') {
        updates.plan = 'free';
        updates.planName = 'Free';
        updates.featureLimits = getFeatureLimits(getPlanById('free'));
      }
      await db.collection('users').doc(userId).set(updates, { merge: true });
      console.log(`[WEBHOOK] User ${userId} subscription updated: ${subscriptionStatus}`);
    } else {
      console.warn('[WEBHOOK] No userId in subscription.metadata');
    }
  }

  // Handle subscription deleted (canceled)
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId;
    if (userId) {
      await db.collection('users').doc(userId).set(
        {
          plan: 'free',
          planName: 'Free',
          subscriptionStatus: 'canceled',
          featureLimits: getFeatureLimits(getPlanById('free')),
          updatedAt: new Date(),
        },
        { merge: true }
      );
      console.log(`[WEBHOOK] User ${userId} subscription canceled.`);
    } else {
      console.warn('[WEBHOOK] No userId in subscription.metadata');
    }
  }

  res.status(200).send('Received');
};


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

    // Update Firestore user document with perks and usage tracking
    // Plan mapping and feature limits
    const plans = [
      {
        id: 'free',
        name: 'Free',
        features: [
          { feature: 'mockInterview', limit: 2 },
          { feature: 'pdfAnalyze', limit: 5 },
          { feature: 'skribbleAI', limit: 'unlimited' }
        ]
      },
      {
        id: 'premium',
        name: 'Premium',
        features: [
          { feature: 'mockInterview', limit: 10 },
          { feature: 'pdfAnalyze', limit: 25 },
          { feature: 'skribbleAI', limit: 'unlimited' }
        ]
      },
      {
        id: 'pro',
        name: 'Pro',
        features: [
          { feature: 'mockInterview', limit: 'unlimited' },
          { feature: 'pdfAnalyze', limit: 'unlimited' },
          { feature: 'skribbleAI', limit: 'unlimited' }
        ]
      }
    ];
    const priceIdToPlanId = {
      'price_1REom3SDRUk0pjjIaFkMgS5A': 'premium',
      'price_1REonDSDRUk0pjjI1KtZrCJO': 'premium',
      'price_1REop5SDRUk0pjjIHIrb7U5e': 'pro',
      'price_1REoodSDRUk0pjjIIFNczrWQ': 'pro',
    };
    // Try to get priceId from session
    const priceId = session?.metadata?.priceId || session?.display_items?.[0]?.price?.id || session?.items?.[0]?.price?.id || session?.subscription?.items?.data?.[0]?.price?.id;
    const mappedPlanId = priceIdToPlanId[priceId] || planId || 'free';
    const plan = plans.find(p => p.id === mappedPlanId) || plans[0];
    // Build feature limits
    const featureLimits = {};
    plan.features.forEach(f => {
      featureLimits[f.feature] = f.limit;
    });
    if (userId) {
      await db.collection('users').doc(userId).set(
        {
          plan: plan.id,
          planName: plan.name,
          subscriptionId,
          subscriptionStatus: 'active',
          updatedAt: new Date(),
          featureLimits,
          usageHistory: [],
        },
        { merge: true }
      );
    }
  }

  // Handle subscription updates (renewal, status changes)
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId;
    const planId = subscription.items?.data?.[0]?.price?.product;
    const planName = subscription.items?.data?.[0]?.price?.nickname;
    const subscriptionStatus = subscription.status;
    if (userId) {
      // If subscription is active, reset interviewsLeft (or increment as needed)
      let updates = {
        subscriptionStatus,
        updatedAt: new Date(),
      };
      if (subscriptionStatus === 'active') {
        updates.plan = planId;
        updates.planName = planName;
        updates.interviewsLeft = planId === 'premium' ? 5 : 0; // Reset for premium
      }
      if (subscriptionStatus === 'canceled' || subscriptionStatus === 'unpaid' || subscriptionStatus === 'incomplete_expired') {
        updates.plan = 'free';
        updates.planName = 'Free';
        updates.interviewsLeft = 0;
      }
      await db.collection('users').doc(userId).set(updates, { merge: true });
    }
  }

  // Handle subscription deleted (canceled)
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId;
    if (userId) {
      await db.collection('users').doc(userId).set(
        {
          plan: 'free',
          planName: 'Free',
          subscriptionStatus: 'canceled',
          interviewsLeft: 0,
          updatedAt: new Date(),
        },
        { merge: true }
      );
    }
  }

  res.status(200).send('Received');


// Vercel config: disable default body parsing for raw body support
export const config = {
  api: {
    bodyParser: false,
  },
};
