# Meta Developer App Setup Guide

**One-time setup for automated Instagram Reels posting.**

This guide walks you through everything Meta requires so your automation can post Reels on its own. You'll do this once, fill in a few values in your `.env` file, and the system handles the rest. Budget about 45-60 minutes the first time.

You don't need to be a developer. Where you hit an API concept, it's explained the first time it shows up. Follow the steps in order, because each one produces a value the next step needs.

**What you'll have when you're done:**
- A Facebook Page linked to a Business Instagram account
- A Meta app with permission to publish Reels
- A long-lived access token (the password your automation uses to post)
- A public place to host your videos so Meta can fetch them
- Three values pasted into `.env`: `META_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID`, `VIDEO_PUBLIC_URL_BASE`

> **Term: API.** "Application Programming Interface" — the doorway Meta opens so software (your automation) can talk to Instagram directly instead of you tapping the app by hand.
>
> **Term: Graph API.** Meta's specific API. Every Instagram and Facebook action your system takes goes through it. Your code already targets version `v21.0`.

---

## Step 1 — Facebook Page + Instagram Business Account

Instagram's posting API does not work on a personal account, and it routes everything through a Facebook Page. So even though you only care about Instagram, you need a Page, and the two accounts have to be linked. This is a Meta requirement, not a quirk of this project.

### 1a. Create a Facebook Page (if you don't have one)

1. Go to [facebook.com/pages/create](https://www.facebook.com/pages/create).
2. Give it a name (your brand name is fine) and pick a category.
3. That's it. You don't need to post anything to it. It exists only to connect your app to Instagram.

### 1b. Make your Instagram a Business or Creator account

A personal Instagram account cannot publish through the API. Convert it:

1. Open Instagram on your phone → **Profile** → menu (☰) → **Settings and privacy**.
2. Tap **Account type and tools** → **Switch to professional account**.
3. Choose **Business** (Creator also works; Business is the safe default).
4. Follow the prompts. Your username, posts, and followers stay exactly the same.

### 1c. Link Instagram to the Facebook Page

1. On your Facebook Page, go to **Settings** → **Linked accounts** (or **Settings** → **Instagram**).
2. Click **Connect account** and log in with your Instagram credentials.
3. Confirm the link.

> **Checkpoint:** You now have a Facebook Page and a Business Instagram account that are linked. Keep both logged in on your computer's browser for the next steps.

---

## Step 2 — Meta Developer Account

This is a separate, free account that lets you create "apps." An app here is just a set of credentials and permissions. Your followers never see it.

1. Go to [developers.facebook.com](https://developers.facebook.com).
2. Click **Log In** (top right) and sign in with the **same Facebook account** that owns your Page.
3. If this is your first time, it'll ask you to register as a developer. Accept the terms and verify your account (it may ask for a phone number).
4. Once registered, click **My Apps** → **Create App**.
5. When asked for a use case / app type, choose **Business**.
6. Enter an **App name**. This is internal only, so anything works (e.g. "Leverage Stack Poster"). Add your contact email.
7. Click **Create App**. You may need to re-enter your password.

You'll land on the **App Dashboard**. Bookmark this page, you'll come back to it.

> **Find your App ID and App Secret now, you'll need both later.**
> In the dashboard, go to **App settings** → **Basic**.
> - **App ID** is shown at the top (a long number).
> - **App Secret** is hidden, click **Show** and enter your password to reveal it.
>
> Copy both somewhere safe temporarily. Treat the App Secret like a password — never paste it into a public chat, screenshot, or git commit.

---

## Step 3 — Add the Instagram Graph API Product

A "product" in the dashboard is a capability you bolt onto your app. You need the Instagram one so your app is allowed to publish Reels.

1. In the App Dashboard, find **Add products to your app** (or the **+ Add Product** button in the left sidebar).
2. Locate **Instagram** (it may appear as "Instagram Graph API" or "Instagram" with a Graph API option) and click **Set up**.
3. If prompted to choose, pick the option for **Instagram API with Instagram Login** / **Instagram Graph API** publishing.

**Permissions your automation needs.** These are the specific powers you'll grant the access token in Step 4:

- `instagram_content_publish` — lets the app actually post Reels. This is the important one.
- `pages_read_engagement` — lets the app read your Page so it can find the linked Instagram account.
- `pages_show_list` — lets the app see the list of Pages you manage (needed to locate the right one).
- `business_management` — sometimes required so the app can act on behalf of your Business account.

You don't grant these here, you just need to know the names. You'll select them in the next step.

> **About App Review.** Meta normally requires apps to pass a review before using publishing permissions publicly. The good news: as the app's owner/admin/developer, you can use these permissions on **your own** accounts in development mode without submitting for review. Since this app only ever posts to your own Instagram, you can stay in development mode indefinitely. No review needed.

---

## Step 4 — Get a Long-Lived Access Token

> **Term: Access token.** A long secret string that proves to Meta "this software is allowed to act as me." Your automation sends it with every post. Anyone holding it can post as you, so guard it like a password.

Tokens come in two flavors. A **short-lived** token lasts about 1 hour, fine for testing but useless for automation. A **long-lived** token lasts about 60 days. You'll generate a short one, then trade it for a long one.

### 4a. Generate a short-lived token

1. Go to the **Graph API Explorer**: [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer).
2. Top right, in the **Meta App** dropdown, select your app.
3. Click the **Generate Access Token** button (or the **User or Page** dropdown → **Get User Access Token**).
4. A permissions window opens. Check these boxes:
   - `instagram_content_publish`
   - `pages_read_engagement`
   - `pages_show_list`
   - `business_management`
5. Click **Generate Access Token**. A Facebook login/consent popup appears, approve it for your Page and Instagram account.
6. A token string now appears in the **Access Token** field. Copy it. This is your **short-lived token** — it expires in about an hour, so move to the next step promptly.

### 4b. Exchange it for a long-lived token

This is a single command you run in your terminal. It asks Meta to swap the 1-hour token for a 60-day one.

> **Term: curl.** A command-line tool for sending web requests. It's built into Windows 10/11. You run it in PowerShell or Command Prompt.

Open **PowerShell** and run the command below. Replace the three placeholders first:
- `APP_ID` → your App ID from Step 2
- `APP_SECRET` → your App Secret from Step 2
- `SHORT_TOKEN` → the short-lived token you just copied

```bash
curl -X GET "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN"
```

The response looks like this:

```json
{
  "access_token": "EAAG...a very long string...",
  "token_type": "bearer",
  "expires_in": 5184000
}
```

The `access_token` value is your **long-lived token**. `expires_in: 5184000` is 60 days in seconds, confirming it worked. **Copy this long token, it's the value you'll put in `.env` as `META_ACCESS_TOKEN`.**

> **If you get an error** mentioning "Invalid OAuth access token," your short-lived token already expired. Go back to Step 4a, generate a fresh one, and run the exchange command again right away.

---

## Step 5 — Find Your Instagram Account ID

Your automation needs the numeric ID of your Instagram Business account (not your @username). You'll get it with two quick Graph API calls. You can run these right in the **Graph API Explorer** from Step 4, no curl needed.

### 5a. Find your Page ID

In the Graph API Explorer, make sure your long-lived token is in the token field, then in the request bar enter:

```
me/accounts
```

Click **Submit**. The response lists the Pages you manage:

```json
{
  "data": [
    {
      "name": "Your Page Name",
      "id": "100xxxxxxxxxxxxxx",
      ...
    }
  ]
}
```

Copy the `id` of your Page (the `100...` number).

### 5b. Get the Instagram account ID from the Page

Now enter this in the request bar, replacing `PAGE_ID` with the number you just copied:

```
PAGE_ID?fields=instagram_business_account
```

Click **Submit**. The response:

```json
{
  "instagram_business_account": {
    "id": "178xxxxxxxxxxxxxx"
  },
  "id": "100xxxxxxxxxxxxxx"
}
```

The `instagram_business_account.id` value (the `178...` number) is your Instagram Account ID. **Copy it, this goes in `.env` as `INSTAGRAM_ACCOUNT_ID`.**

> **If `instagram_business_account` is missing** from the response, the link from Step 1c didn't take. Re-check that your Instagram is a Business account and is connected to this exact Page, then try again.

---

## Step 6 — Fill in the .env File

> **Term: .env file.** A plain text file holding your secrets. It lives outside your code so the secrets never end up in git. Your automation reads its values at runtime.

Your `.env` file lives here:

```
C:\Users\jesse\Documents\Projects\TheLeverageStack\.env
```

If only `.env.example` exists, make a copy named exactly `.env` (no `.example`). In PowerShell:

```powershell
Copy-Item "C:\Users\jesse\Documents\Projects\TheLeverageStack\.env.example" "C:\Users\jesse\Documents\Projects\TheLeverageStack\.env"
```

Open `.env` in any text editor and fill in the two Meta values you collected:

```bash
# Meta Graph API (Instagram + Facebook)
META_ACCESS_TOKEN=EAAG...your long-lived token from Step 4b...
INSTAGRAM_ACCOUNT_ID=178xxxxxxxxxxxxxx
```

Leave `VIDEO_PUBLIC_URL_BASE` for the next step. Save the file.

> **Never commit `.env` to git.** It holds your token and account ID. The project is already set up to ignore it, but double-check it never shows up in a commit.

---

## Step 7 — Set Up Video Hosting (Required)

Meta will not accept a video file uploaded directly from your computer. Instead, it requires a **public URL** it can fetch the video from. So your automation needs to put each MP4 somewhere on the public web first, then hand Meta the link.

The recommended host is **Cloudflare R2**: 10 GB of storage free, and it gives you clean public URLs. (Each Reel is only a few MB, so 10 GB is hundreds of videos.)

> **Term: bucket.** A named folder in cloud storage. You upload files into it, and each file gets a public URL.

### 7a. Create a Cloudflare account and R2 bucket

1. Sign up free at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
2. In the dashboard sidebar, click **R2**. You may be asked to add a payment method to activate R2, even on the free tier you won't be charged until you exceed 10 GB. (Beyond that it's about $0.015 per GB per month, pennies.)
3. Click **Create bucket**. Name it something like `leverage-stack`. Choose the default location. Click **Create bucket**.

### 7b. Make the bucket public

1. Open your new bucket → **Settings**.
2. Find **Public access** → **R2.dev subdomain** → click **Allow Access** / **Enable**.
3. Cloudflare gives you a public domain that looks like:
   ```
   https://pub-abc123def456.r2.dev
   ```
   Copy it.

### 7c. Build your VIDEO_PUBLIC_URL_BASE

Your automation builds each video's link as `VIDEO_PUBLIC_URL_BASE` + `/` + the filename. So set the base to your R2 public domain plus a folder name. Using the project's default folder name `leverage-stack`:

```bash
# Video hosting
VIDEO_PUBLIC_URL_BASE=https://pub-abc123def456.r2.dev/leverage-stack
```

Paste that into `.env` (replace the example domain with your real `pub-...r2.dev` one). Save.

> **How files get to R2.** Your posting pipeline uploads the MP4 into the bucket before calling Meta. If you ever upload manually for a test, the file must land at the path that matches this base — e.g. a video named `clip01.mp4` should be reachable at `https://pub-abc123def456.r2.dev/leverage-stack/clip01.mp4`. Paste that full URL into a browser; if the video plays or downloads, Meta can reach it too.

### 7d. Test that the URL is public

Upload any small test MP4 into your bucket (Cloudflare dashboard → your bucket → **Upload**), then open its full public URL in a browser. If it plays or downloads without asking you to log in, you're set. If it gives an "access denied" error, recheck Step 7b.

> **Backup option: AWS S3.** S3's free tier (5 GB for 12 months) also works. Create a bucket, set its policy to allow public reads, and use the bucket's public URL as `VIDEO_PUBLIC_URL_BASE`. R2 is simpler and has no 12-month limit, so prefer it unless you already live in AWS.

---

## Step 8 — Test the Connection

Time to confirm the whole chain works. Make sure at least one MP4 is in the posting queue and reachable at its public URL, then run:

```bash
node automation/post.js
```

Run it from the project root (`C:\Users\jesse\Documents\Projects\TheLeverageStack`).

**What success looks like.** The script logs each stage as Meta processes the video:

```
[post] Posting: clip01.mp4
[post] Caption preview: ...
[post] Container created: 178xxxxxxxxxxxxxx
[post] Container status: IN_PROGRESS (attempt 1)
[post] Container status: FINISHED (attempt 3)
[post] Published! Media ID: 179xxxxxxxxxxxxxx
[post] Done. Moved to posted/. Media ID: 179xxxxxxxxxxxxxx
```

When you see **Published!** and a Media ID, check Instagram, the Reel is live. The video file moves from `content/queue/` to `content/posted/` so it won't post twice.

**Common errors and what they mean:**

| Message | Cause | Fix |
|---|---|---|
| `.env file missing` | No `.env` in project root | Do Step 6 — copy `.env.example` to `.env` |
| `VIDEO_PUBLIC_URL_BASE not set` | That line is empty in `.env` | Do Step 7c |
| `Graph API error ... Invalid OAuth access token` | Token wrong or expired | Regenerate the long-lived token (Step 4) and update `.env` |
| `Graph API error ... (#10) ... permission` | Missing `instagram_content_publish` | Redo Step 4a and check that permission box, then re-exchange |
| `Container processing failed on Meta side` | Meta couldn't fetch or decode the video | Confirm the URL opens in a browser and the file is real 1080x1920 MP4 |
| `Queue is empty` | No MP4 in `content/queue/` | Add a video and rerun |

> **The video must already be live at its public URL before you run this.** Meta fetches it from the internet, it never reads your local disk.

---

## Step 9 — Token Renewal (Every ~60 Days)

Your long-lived token expires about 60 days after you create it. When it does, posting stops with an "Invalid OAuth access token" error until you refresh it. This is the one piece of ongoing maintenance.

> **Set a calendar reminder for day 50** (ten days before expiry, so you have a buffer). A recurring reminder every 50 days is ideal.

**To refresh**, run this in PowerShell. It's the same exchange call as Step 4b, fed your *current* (still-valid) long-lived token. Replace the placeholders:
- `APP_ID` → your App ID
- `APP_SECRET` → your App Secret
- `CURRENT_TOKEN` → the long-lived token currently in your `.env`

```bash
curl -X GET "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=CURRENT_TOKEN"
```

The response is a fresh token with a new 60-day clock:

```json
{
  "access_token": "EAAG...a new long string...",
  "token_type": "bearer",
  "expires_in": 5184000
}
```

Copy the new `access_token`, paste it into `.env` as `META_ACCESS_TOKEN` (replacing the old one), and save. Done for another 60 days.

> **If you wait too long and the token already expired,** this refresh call fails because it needs a valid token to swap. In that case, start over from Step 4a (generate a fresh short-lived token in the Graph API Explorer, then exchange it). Same result, just one extra step.

---

## Quick Reference

When everything's done, your `.env` Meta section should look like this (with your real values):

```bash
META_ACCESS_TOKEN=EAAG...long-lived token...
INSTAGRAM_ACCOUNT_ID=178xxxxxxxxxxxxxx
VIDEO_PUBLIC_URL_BASE=https://pub-abc123def456.r2.dev/leverage-stack
```

| What | Where it came from |
|---|---|
| App ID & App Secret | Step 2 — App settings → Basic |
| `META_ACCESS_TOKEN` | Step 4b — long-lived token exchange |
| `INSTAGRAM_ACCOUNT_ID` | Step 5b — `instagram_business_account.id` |
| `VIDEO_PUBLIC_URL_BASE` | Step 7c — R2 public domain + folder |

**Recurring task:** refresh the token every ~50 days (Step 9).
