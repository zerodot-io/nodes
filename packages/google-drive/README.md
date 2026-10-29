# @zerodot/google-drive

Find, upload, download, copy, move, delete, and share files and folders in Google Drive. Start a workflow when a file is new or changed. Connect with Google sign-in or a service account.

## Install

In zerodot, go to **System > Nodes** and install **Google Drive**.

Manual: install `@zerodot/google-drive` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Google Drive (`google_drive.api`)

- **File**: list or search, get, download, upload, create from text, update, copy, move, delete, share
- **Folder**: create, delete, share
- **Permission**: list, delete

A file or folder can be a URL or an ID. All calls work in shared drives too.

- **List or search**: filter by folder, name, type, or a [Drive query](https://developers.google.com/drive/api/guides/search-files). Filters join with `and`. Trashed files are not in the result unless you turn on **Include Trashed**. **Return All** reads all pages (up to 10000 files).
- **Download**: the content goes to `binary.<property>` of the output (`data` by default). A Google Docs, Sheets, or Slides file has no bytes, so the node exports it. The default format is PDF (Sheets: `xlsx`). Set **Export Format** to use another MIME type. Google limits an export to 10 MB.
- **Upload**: the binary data comes from `binary.<property>` of the input. When you do not set a name, the node uses the file name of the binary data. When you set a Google MIME type, for example `application/vnd.google-apps.document`, Drive converts the file. The node sends the file in one request, so use it for files up to 5 MB.
- **Move**: the node adds the new folder and removes the old folders.
- **Delete**: the file goes to the trash. Turn on **Delete Permanently** to skip the trash. You cannot undo this.
- **Share**: give `reader`, `commenter`, or `writer` access to a user, a group, a domain, or anyone with the link. Shared drives also have `fileOrganizer` and `organizer`. For a user or a group, the node can send an email with a message.
- **Permission list**: gives the permission IDs. Use an ID to remove access.

### On Google Drive file change (`trigger.google_drive`)

The trigger checks Drive on a timer (every 60 seconds by default) and starts one run for each file. The input of the run is the file.

- **File Created**: a new file or folder.
- **File Created or Changed**: a new file, or a file with a new `modifiedTime`.

Set a **Folder** to watch only the direct children of that folder. Sub-folders are not watched. **Type** keeps only files or only folders. The files that exist when the trigger starts do not start runs. Trashed files are skipped.

## Credentials

- **Google Drive OAuth2** (`google_drive.oauth2`): `clientId` and `clientSecret` of a Google Cloud OAuth client. Scope `https://www.googleapis.com/auth/drive`. zerodot refreshes the token. The client secret and the tokens are secret.
- **Google Drive service account** (`google_drive.service_account`): the JSON key file of a service account, as text. Share each file or folder with the email of the service account. The key is secret. A service account has no storage space of its own, so upload into a folder that is shared with it, or into a shared drive.

Turn on the Google Drive API in the Google Cloud project.

## License

AGPL-3.0-only
