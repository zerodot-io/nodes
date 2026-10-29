# @zerodot/stripe

Manage customers, payments, invoices, subscriptions, refunds, and coupons with Stripe. Start a workflow when Stripe sends an event. Use it for billing and payment automation.

## Install

In zerodot, go to **System > Nodes** and install **Stripe**.

Manual: install `@zerodot/stripe` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Stripe (`stripe.api`)

- **Customer**: create, get, update, delete, list
- **Payment Intent**: create, get, confirm, cancel, list
- **Charge**: get, list
- **Refund**: create, get, list
- **Invoice**: create, get, finalize, pay, void, list
- **Subscription**: create, get, update, cancel, list
- **Product**: create, get, list
- **Price**: create, get, list (one time or recurring)
- **Coupon**: create, get, list
- **Balance**: get
- **Checkout Session**: create, get

The node sends form requests to the Stripe API with `fetch`. It has no other dependency. Amounts use the smallest unit of the currency. For USD, 1000 is $10.00. Set **Metadata** as a JSON object. Set **Prices** as price IDs with commas between, and add a quantity after a colon, such as `price_1:2,price_2`.

Each write operation has an optional **Idempotency Key**. Stripe runs a request with the same key only once, so a retry is safe. A list can return all items (at most 5000) or a limit. Lists can use filters, such as customer, status, and a date range. When Stripe gives an error, the node fails with the message, the error code, and a short help text. A rate limit (HTTP 429) gives the time to wait from `Retry-After`, when Stripe sends it.

### Stripe Trigger (`trigger.stripe`)

Starts a run when Stripe sends an event. Choose from common events, such as:

- **Payment Succeeded**, **Payment Failed**, **Charge Refunded**, **Dispute Created**
- **Customer Created**, **Customer Updated**, **Customer Deleted**
- **Subscription Created**, **Subscription Updated**, **Subscription Canceled**, **Trial Ends Soon**
- **Invoice Created**, **Invoice Finalized**, **Invoice Paid**, **Invoice Payment Failed**, **Invoice Voided**
- **Checkout Completed**

Use **Other Event Types** for more events, such as `payout.paid`. End a type with `.*` to match a group, such as `invoice.*`.

The output has `id`, `type`, `created`, `livemode`, `account`, `object` (the Stripe object of the event), and `previousAttributes`.

Add the webhook address of the trigger in the Stripe Dashboard, under **Developers > Webhooks**. Copy the signing secret (`whsec_…`) to the credential. Each request must have a valid `Stripe-Signature`. The node checks the HMAC-SHA256 signature, and it refuses a request with a timestamp that is more than 5 minutes old.

Stripe sends events only to the address in the Dashboard, so test listening is not available. Publish the workflow to get events.

## Credential

**Stripe account** (`stripe.account`): `secretKey` (`sk_…`, or a restricted key `rk_…`) from **Developers > API keys**, and `webhookSecret` (`whsec_…`) from the webhook endpoint. Only the trigger needs `webhookSecret`. Both are secret. The **Test** button reads the balance.

## License

AGPL-3.0-only
