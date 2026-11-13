# Meta

Publish to **Instagram**, **Facebook Pages**, and **Threads** with one node, and start a workflow on a Meta webhook.

The node speaks to the Graph API (`graph.facebook.com`) and the Threads API (`graph.threads.net`). One credential works for all three platforms: a long-lived access token of a Meta app.

## Setup

1. Create an app at [developers.facebook.com/apps](https://developers.facebook.com/apps), of type Business.
2. Add the products that you need: Instagram Graph API, Pages, and Threads API.
3. Make a long-lived access token with the scopes of the platform:
   - Instagram: `instagram_basic`, `instagram_content_publish`
   - Facebook Pages: `pages_read_engagement`, `pages_manage_posts`
   - Threads: `threads_basic`, `threads_content_publish`
4. Put the token in the credential. For Facebook Page posts, use a **Page access token** (`/me/accounts` gives them).

The Instagram account needs to be a Business or Creator account that is linked to a Facebook Page.

## Actions

| Action                               | What it does                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Publish to Instagram                 | Creates the media container, waits until Meta has the media, and publishes it |
| Create an Instagram media container  | Makes the container only, for reel, photo, carousel, or story                 |
| Check an Instagram media container   | `FINISHED`, `IN_PROGRESS`, `ERROR`, or `EXPIRED`                              |
| Publish an Instagram media container | Publishes a container that is finished                                        |
| Get the Instagram publishing quota   | How many posts the account can still publish in 24 hours (50 to 100)          |
| Get Instagram account info           | ID, username, and follower count                                              |
| Publish to a Facebook Page           | A text post, a photo, or a video on the feed of the Page                      |
| Get Facebook Page info               | ID, name, username, and follower count                                        |
| Publish to Threads                   | Text, image, carousel, or video                                               |
| Get Threads profile                  | ID, username, and biography                                                   |

The media must be at a public HTTPS address, such as an S3 object or a CDN link. Meta downloads the media itself.

## Trigger

The Meta Trigger starts the workflow on a webhook event: comments, mentions, messages, story insights, and more, for Instagram, a Facebook Page, or Threads.

1. In the Webhooks settings of the Meta app, subscribe to the object.
2. Set the Callback URL to the webhook address of the trigger, and the Verify token to any text.
3. Meta sends a GET with `hub.challenge`, and the trigger answers with it.
4. Put the **App secret** of the app in the credential. Each event comes signed with `X-Hub-Signature-256`, and the trigger checks it.

## Development

```sh
pnpm test
pnpm build
```
