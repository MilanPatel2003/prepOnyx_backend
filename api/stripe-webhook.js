const Stripe = require('stripe');
const admin = require('firebase-admin');
const getRawBody = require('raw-body');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    return res.status(400).send('Invalid body');
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
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // --- Plan & Feature Logic ---
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

  // --- Stripe Event Handling ---
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId } = session.metadata || {};
    const subscriptionId = session.subscription;
    const priceId = session?.metadata?.priceId || session?.display_items?.[0]?.price?.id || session?.items?.[0]?.price?.id || session?.subscription?.items?.data?.[0]?.price?.id;
    const mappedPlanId = priceIdToPlanId[priceId] || session.metadata?.planId || 'free';
    const plan = getPlanById(mappedPlanId);
    const featureLimits = getFeatureLimits(plan);
    // Fetch subscription from Stripe to get current_period_end
    let subscriptionEndDate = null;
    if (subscriptionId) {
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
        if (stripeSubscription && stripeSubscription.current_period_end) {
          subscriptionEndDate = new Date(stripeSubscription.current_period_end * 1000);
        }
      } catch (err) {
        console.error('Failed to fetch subscription from Stripe:', err);
      }
    }
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
          ...(subscriptionEndDate ? { subscriptionEndDate } : {}),
        },
        { merge: true }
      );
      console.log(`[WEBHOOK] User ${userId} upgraded to plan ${plan.id}`);
    } else {
      console.warn('[WEBHOOK] No userId in session.metadata');
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId;
    const priceId = subscription.items?.data?.[0]?.price?.id;
    const mappedPlanId = priceIdToPlanId[priceId] || 'free';
    const plan = getPlanById(mappedPlanId);
    const featureLimits = getFeatureLimits(plan);
    const subscriptionStatus = subscription.status;
    // Get period end from Stripe (UNIX timestamp in seconds)
    let subscriptionEndDate = null;
    if (subscription.current_period_end) {
      subscriptionEndDate = new Date(subscription.current_period_end * 1000);
    }
    if (userId) {
      let updates = {
        subscriptionStatus,
        updatedAt: new Date(),
        ...(subscriptionEndDate ? { subscriptionEndDate } : {}),
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

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId;
    let subscriptionEndDate = null;
    if (subscription.current_period_end) {
      subscriptionEndDate = new Date(subscription.current_period_end * 1000);
    }
    if (userId) {
      await db.collection('users').doc(userId).set(
        {
          plan: 'free',
          planName: 'Free',
          subscriptionStatus: 'canceled',
          featureLimits: getFeatureLimits(getPlanById('free')),
          updatedAt: new Date(),
          ...(subscriptionEndDate ? { subscriptionEndDate } : {}),
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

export const config = {
  api: {
    bodyParser: false,
  },
};