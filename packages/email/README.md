# @zerodot/email

Send email through an SMTP server, and start a workflow when a new email arrives in an IMAP mailbox. Use it for notifications and reports, or to react to incoming mail.

## Install

In zerodot, go to **System > Nodes** and install **Email**.

Manual: install `@zerodot/email` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Send Email (`email.send`)

Sends an email over SMTP. It can send text, HTML, or both, with attachments, CC, BCC, and a reply-to address.

### On new email (IMAP) (`trigger.email_imap`)

Starts a run when a new unread mail arrives in a mailbox (default `INBOX`). After the run starts, it can mark the mail as read.

Output formats:

- **Simple**: subject, addresses, text, HTML, and a list of the attachments
- **Resolved**: the same as simple, and the attachments as binary data
- **Raw**: the full message as base64 text

## Credentials

- **SMTP** (`smtp`): `host`, `port`, `user`, `password`, `secure`, `disableStartTls`, `hostName`. The password is secret.
- **IMAP** (`imap`): `host`, `port`, `user`, `password`, `secure`, `allowUnauthorizedCerts`. The password is secret.

## License

AGPL-3.0-only
