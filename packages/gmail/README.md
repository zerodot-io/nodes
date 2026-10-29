# @zerodot/gmail

Send, reply to, and draft emails in Gmail. Read, search, label, trash, and delete messages and threads, with attachments as binary data. A trigger starts a run for each new email that matches a query. Connect with Google sign-in or a service account.

## Install

In zerodot, go to **System > Nodes** and install **Gmail**.

Manual: install `@zerodot/gmail` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Gmail (`gmail.api`)

- **Message**: send, reply, get, get many (search), mark as read, mark as unread, move to trash, restore from trash, delete, add labels, remove labels
- **Draft**: create, get, get many, delete
- **Label**: create, get, get many, delete
- **Thread**: get, get many, move to trash, restore from trash, delete, add labels, remove labels

**Send and draft.** Set `to`, `cc`, `bcc`, and `subject`. Use a comma between addresses. A name works: `Nathan Doe <nate@example.com>`. The format is text, HTML, or both. To attach files, put the names of the binary properties of the input in **Attachments**, with commas between. The name of a property is also the content ID of the file. To show an image in the body, use `<img src="cid:image_1">`. **From** must be an alias of the mailbox.

**Reply.** The node reads the message, then sends the answer in the same thread. It sets `Re:` in the subject, and the `In-Reply-To` and `References` headers. The answer goes to the `Reply-To` address of the message, or to the sender. **Reply to All** also sends the answer to the other recipients, but not to the mailbox itself.

**Get and get many.** **Search** uses the Gmail search syntax, for example `from:ann@example.com has:attachment`. **Labels** limits the search to items with all the labels. **Simplify** gives these fields: `id`, `threadId`, `labelIds`, `snippet`, `internalDate`, `messageId`, `subject`, `from`, `to`, `cc`, `bcc`, `replyTo`, `date`, `text`, `html`, and `attachments` (the file name, type, and size of each file). When Simplify is off, the node gives the full answer of Gmail. **Download Attachments** adds the files to `binary` as `attachment_0`, `attachment_1`, and so on. This works with Simplify only. The size limit of a node output applies to the files.

**Labels.** In **Labels**, write label names or IDs with commas between. The node finds the ID of a name without regard to case. System labels, for example `INBOX`, `STARRED`, and `UNREAD`, work as they are. **Mark as read** removes `UNREAD`. **Mark as unread** adds it.

**Delete.** **Delete** removes a message, a thread, or a draft for good. Use **Move to Trash** if you want to keep a way back. Gmail removes items from the trash after 30 days.

**Get many threads** gives the ID of each thread. Use **Get** with a thread ID to read its messages.

### On new email (Gmail) (`gmail.trigger`)

A polling trigger. It checks the mailbox on a timer (**Check Every**, 60 seconds by default). It starts one run for each new email. The first check starts no runs. It only sets the start time.

- **Search**, **Labels**, **Sender**, and **Read Status** (unread by default) limit the mails.
- **Include Spam and Trash** adds these folders.
- **Simplify** and **Download Attachments** work as in the Gmail node.
- **Action**: **Mark as read** removes `UNREAD` from each mail after the run starts.
- **Most Mails per Check** limits one check. The next check gets the others.

The input of the run is the email. Each mail starts one run only, also when the mail stays unread.

## Credentials

Scope: `https://mail.google.com/`. Gmail needs this scope to delete messages for good.

- **Gmail OAuth2** (`gmail.oauth2`): `clientId` and `clientSecret` of a Google Cloud OAuth client. Sign in with a Google account. zerodot refreshes the token. The client secret and the tokens are secret.
- **Gmail service account** (`gmail.service_account`): the JSON key file of a service account, as text, and `impersonatedUser`, the email address of the user that the service account acts as. The key is secret. A service account has no mailbox of its own, so you must turn on domain-wide delegation:
  1. In Google Cloud, turn on domain-wide delegation for the service account. Copy its client ID.
  2. In the Google Workspace admin console, go to **Security > API controls > Domain-wide delegation**. Add the client ID with the scope `https://mail.google.com/`.

Turn on the Gmail API in the Google Cloud project.

## License

AGPL-3.0-only
