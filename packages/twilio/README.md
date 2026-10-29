# @zerodot/twilio

Send and read SMS, MMS, and WhatsApp messages, make and read phone calls, and look up phone numbers with Twilio, and start a workflow on an incoming message or a status update. Use it for alerts, verification, and customer messages.

## Install

In zerodot, go to **System > Nodes** and install **Twilio**.

Manual: install `@zerodot/twilio` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Twilio (`twilio.api`)

- **Message**: send (SMS, MMS, or WhatsApp), get, list, delete
- **Call**: make (from TwiML or from a TwiML URL), get, list
- **Phone Number**: look up a number, with the optional data packages Line Type, Caller Name, and SMS Pumping Risk

For a WhatsApp message, choose the **WhatsApp** channel. The node adds the `whatsapp:` prefix to the numbers. Outside the 24 hour window after a user message, WhatsApp needs a template: set **Content Template SID** and the variables. A list can return all items (at most 5000) or a limit. When Twilio gives an error, the node fails with the message, the error code, and a short help text. A rate limit (HTTP 429) gives the time to wait from `Retry-After`.

### Twilio Trigger (`trigger.twilio`)

Starts a run on a request from Twilio:

- **Incoming Message**: someone sent an SMS, an MMS, or a WhatsApp message to your number
- **Message Status**: a message that you sent changed status, such as `delivered` or `failed`
- **Call Status**: a call that you made changed status, such as `completed`

You can accept events only for some numbers. Set the webhook address of the trigger in the Twilio Console: as **A message comes in** of a phone number (or of a Messaging Service), or as the **Status Callback URL** of a message or a call. Each request must have a valid `X-Twilio-Signature`. The signature uses the full address, so use the address exactly as zerodot shows it.

The trigger does not answer with TwiML, so it cannot control an incoming call. Use it for messages and for status updates.

Twilio sends events only to the address in the console, so test listening is not available. Publish the workflow to get events.

## Credential

**Twilio account** (`twilio.account`): `accountSid` (starts with `AC`) and `authToken`, both from the Twilio Console dashboard. `authToken` is secret, and the trigger uses it to check the signature. The **Test** button reads the account.

## License

AGPL-3.0-only
