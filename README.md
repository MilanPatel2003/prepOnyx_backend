# PrepOnyx Backend Stripe Checkout API

This backend exposes a Vercel-compatible serverless function for Stripe-powered subscription checkout.

## Endpoint

POST `/api/create-checkout-session`

### Request Body
```
{
  "planId": "starter_monthly",
  "planName": "Starter Monthly",
  "priceId": "price_1N..."
}
```

### Response
```
{
  "url": "https://checkout.stripe.com/pay/..."
}
```

## Environment Variables
- `STRIPE_SECRET_KEY`: Your Stripe secret key
- `FRONTEND_URL`: Your frontend base URL (for redirects)

Copy `.env.example` to `.env` and fill in your values.

## Deployment (Vercel Serverless)
Deploy to Vercel. The `/api` folder will be recognized as serverless functions.

---

You can use Vercel serverless functions for deployment. If you need further customization, let me know!
