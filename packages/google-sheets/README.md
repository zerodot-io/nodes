# @zerodot/google-sheets

Read, append, update, and delete rows in Google Sheets, with a header row that maps each row to an object. Create spreadsheets and tabs, and clear ranges. Connect with Google sign-in or a service account.

## Install

In zerodot, go to **System > Nodes** and install **Google Sheets**.

Manual: install `@zerodot/google-sheets` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Google Sheets (`google_sheets.api`)

- **Spreadsheet**: create (with tabs), get
- **Sheet**: get rows, append rows, update rows, append or update rows, clear, delete rows, create a tab, delete a tab

The spreadsheet can be a URL or an ID. When you do not set a tab, the node uses the tab of the `gid` in the URL, or the first tab. A range uses A1 notation, for example `A1:F100` or `B:D`.

The header row (row 1 by default) gives the column names. Each row is an object with these names as keys, and a `row_number`. To write, the keys of each input item are the column names, or you map each column with expressions. Update and append-or-update find the row by a column to match on (or by `row_number`) and change only the cells of the keys in the item. Values go in as typed in the UI (`USER_ENTERED`) or as raw text (`RAW`). Rows come out formatted, unformatted, or as formulas.

## Credentials

- **Google Sheets OAuth2** (`google_sheets.oauth2`): `clientId` and `clientSecret` of a Google Cloud OAuth client. Scope `https://www.googleapis.com/auth/spreadsheets`. zerodot refreshes the token. The client secret and the tokens are secret.
- **Google Sheets service account** (`google_sheets.service_account`): the JSON key file of a service account, as text. Share each spreadsheet with the email of the service account. The key is secret.

Turn on the Google Sheets API in the Google Cloud project.

## License

AGPL-3.0-only
