'use strict';
/**
 * The Leverage Stack — Multi-Platform Poster
 *
 * Posts from content/queue/ to Instagram Reels, Facebook Reels, and TikTok.
 * Injects ClickBank affiliate HopLinks into captions where applicable.
 *
 * Usage:
 *   node automation/post.js             — posts next queued video to all platforms
 *   node automation/post.js --dry-run   — shows what would be posted without posting
 *
 * Required .env keys:
 *   META_ACCESS_TOKEN, INSTAGRAM_ACCOUNT_ID, FACEBOOK_PAGE_ID
 *   TIKTOK_ACCESS_TOKEN, TIKTOK_OPEN_ID
 *   CLICKBANK_DEV_KEY, CLICKBANK_CLERK_KEY, CLICKBANK_NICKNAME (optional)
 */

const fs   = require('fs');
const path = require('path');
const { uploadVideo } = require('./upload-r2');

const ROOT        = path.resolve(__dirname, '..');
const QUEUE_DIR   = path.join(ROOT, 'content', 'queue');
const POSTED_DIR  = path.join(ROOT, 'content', 'posted');
const SCRIPTS_DIR = path.join(ROOT, 'content', 'scripts');
const ENV_PATH    = path.join(ROOT, '.env');
const DRY_RUN     = process.argv.includes('--dry-run');

// ─── Env ─────────────────────────────────────────────────────────────────────

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('[post] .env missing. Copy .env.example and fill in keys.');
    process.exit(1);
  }
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

// ─── Meta Graph API ───────────────────────────────────────────────────────────

async function graphApi(method, endpoint, body = null) {
  const token = process.env.META_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/v21.0${endpoint}${endpoint.includes('?') ? '&' : '?'}access_token=${token}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  if (json.error) throw new Error(`Graph API ${endpoint}: ${JSON.stringify(json.error)}`);
  return json;
}

// ─── Instagram Reels ─────────────────────────────────────────────────────────

async function postInstagram(videoUrl, caption) {
  const igId  = process.env.INSTAGRAM_ACCOUNT_ID;
  const fbPageId = process.env.FACEBOOK_PAGE_ID;

  if (DRY_RUN) {
    console.log(`[instagram] DRY RUN — would post to IG account ${igId}`);
    console.log(`[instagram] Video URL: ${videoUrl}`);
    console.log(`[instagram] Caption (${caption.length} chars): ${caption.slice(0, 120)}...`);
    if (fbPageId) console.log(`[instagram] Would cross-post to FB page ${fbPageId}`);
    return 'dry-run-ig-id';
  }

  const containerBody = {
    video_url:    videoUrl,
    media_type:   'REELS',
    caption,
    share_to_feed: true,
  };
  if (fbPageId) containerBody.cross_post_to_fb_page_id = fbPageId;

  const container = await graphApi('POST', `/${igId}/media`, containerBody);
  console.log(`[instagram] Container: ${container.id}`);

  // Poll until processed
  for (let i = 0; i < 30; i++) {
    await sleep(10000);
    const check = await graphApi('GET', `/${container.id}?fields=status_code`);
    console.log(`[instagram] Status: ${check.status_code} (${i + 1}/30)`);
    if (check.status_code === 'FINISHED') break;
    if (check.status_code === 'ERROR') throw new Error('[instagram] Container processing failed.');
  }

  const result = await graphApi('POST', `/${igId}/media_publish`, { creation_id: container.id });
  console.log(`[instagram] Published. Media ID: ${result.id}`);
  return result.id;
}

// ─── Facebook Reels ───────────────────────────────────────────────────────────
// Used when explicit FB control is needed beyond the IG cross-post.
// Meta's Reels publishing API: init → upload binary → publish.

async function getPageAccessToken(pageId) {
  const userToken = process.env.META_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/v21.0/${pageId}?fields=access_token&access_token=${userToken}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`[facebook] Could not get page token: ${JSON.stringify(json.error)}`);
  if (!json.access_token) throw new Error('[facebook] Page access_token not returned — ensure pages_show_list and pages_manage_posts are granted.');
  return json.access_token;
}

async function graphApiPage(method, pageToken, endpoint, body = null) {
  const url = `https://graph.facebook.com/v21.0${endpoint}${endpoint.includes('?') ? '&' : '?'}access_token=${pageToken}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.error) throw new Error(`Graph API ${endpoint}: ${JSON.stringify(json.error)}`);
  return json;
}

async function postFacebook(videoUrl, caption) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!pageId) {
    console.log('[facebook] FACEBOOK_PAGE_ID not set — skipping standalone FB post.');
    return null;
  }

  if (DRY_RUN) {
    console.log(`[facebook] DRY RUN — would post Reel to FB page ${pageId}`);
    return 'dry-run-fb-id';
  }

  // Get Page Access Token (required for video_reels — user token is not sufficient)
  const pageToken = await getPageAccessToken(pageId);
  console.log('[facebook] Page access token obtained.');

  // Step 1: Initialize upload session
  const init = await graphApiPage('POST', pageToken, `/${pageId}/video_reels`, {
    upload_phase: 'start',
  });
  const videoId = init.video_id;
  const uploadUrl = init.upload_url;
  if (!videoId || !uploadUrl) throw new Error(`[facebook] Init failed: ${JSON.stringify(init)}`);
  console.log(`[facebook] Upload session started. Video ID: ${videoId}`);

  // Step 2: Fetch video from R2 and pipe to Facebook upload URL
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`[facebook] Failed to fetch video from R2: ${videoRes.status}`);
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `OAuth ${pageToken}`,
      'offset': '0',
      'file_size': String(videoBuffer.length),
    },
    body: videoBuffer,
  });
  if (!uploadRes.ok) throw new Error(`[facebook] Upload failed: ${uploadRes.status}`);
  console.log('[facebook] Video uploaded.');

  // Step 3: Publish
  const publish = await graphApiPage('POST', pageToken, `/${pageId}/video_reels`, {
    upload_phase: 'finish',
    video_id:     videoId,
    video_state:  'PUBLISHED',
    description:  caption,
  });
  console.log(`[facebook] Published. Post ID: ${publish.post_id || videoId}`);
  return publish.post_id || videoId;
}

// ─── TikTok ───────────────────────────────────────────────────────────────────

async function postTikTok(videoUrl, caption) {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  const openId      = process.env.TIKTOK_OPEN_ID;

  if (!accessToken || !openId) {
    console.log('[tiktok] TIKTOK_ACCESS_TOKEN or TIKTOK_OPEN_ID not set — skipping.');
    return null;
  }

  // TikTok captions: 2,200 char limit, hashtags in title field
  const title = caption.slice(0, 2200);

  if (DRY_RUN) {
    console.log(`[tiktok] DRY RUN — would post to TikTok (open_id: ${openId})`);
    console.log(`[tiktok] Video URL: ${videoUrl}`);
    return 'dry-run-tt-id';
  }

  // Init: pull-from-URL direct post
  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title,
        privacy_level:   'PUBLIC_TO_EVERYONE',
        disable_comment: false,
        disable_duet:    false,
        disable_stitch:  false,
      },
      source_info: {
        source:    'PULL_FROM_URL',
        video_url: videoUrl,
      },
    }),
  });

  const initJson = await initRes.json();
  if (initJson.error && initJson.error.code !== 'ok') {
    throw new Error(`[tiktok] Init failed: ${JSON.stringify(initJson.error)}`);
  }

  const publishId = initJson.data?.publish_id;
  if (!publishId) throw new Error(`[tiktok] No publish_id returned: ${JSON.stringify(initJson)}`);
  console.log(`[tiktok] Publish ID: ${publishId}. Polling...`);

  // Poll status
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const statusRes = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const statusJson = await statusRes.json();
    const status = statusJson.data?.status;
    console.log(`[tiktok] Status: ${status} (${i + 1}/24)`);
    if (status === 'PUBLISH_COMPLETE') {
      console.log(`[tiktok] Published. Post ID: ${statusJson.data?.publicaly_available_post_id?.[0] || publishId}`);
      return publishId;
    }
    if (status === 'FAILED') throw new Error(`[tiktok] Publish failed: ${JSON.stringify(statusJson)}`);
  }

  console.warn('[tiktok] Timed out polling — post may still be processing.');
  return publishId;
}

// ─── ClickBank Affiliate Links ────────────────────────────────────────────────

const CLICKBANK_VENDORS = {
  elevenlabs: null,    // ElevenLabs has its own affiliate program — use direct link from .env
  writesonic: null,    // same
  koala:      null,    // same
  // Add ClickBank vendor IDs here as you find products to promote:
  // 'vendor-id': 'clickbank_vendor_nickname',
};

async function getClickBankHopLink(vendorId) {
  const devKey      = process.env.CLICKBANK_DEV_KEY;
  const clerkKey    = process.env.CLICKBANK_CLERK_KEY;
  const nickname    = process.env.CLICKBANK_NICKNAME;

  if (!devKey || !clerkKey || !nickname) return null;
  if (!vendorId) return null;

  // HopLink format — no API call needed for basic links
  return `https://${nickname}.${vendorId}.hop.clickbank.net/`;
}

async function buildCaption(script) {
  let caption = script.caption || '#aitools #wealthbuilding #passiveincome #financialfreedom #theleveragestack';

  const affiliate = script.affiliate_mention;

  // Try ClickBank vendor link first
  const vendorId = affiliate && CLICKBANK_VENDORS[affiliate];
  if (vendorId) {
    const hopLink = await getClickBankHopLink(vendorId);
    if (hopLink) {
      caption = caption.replace(/\[AFFILIATE_LINK\]/g, hopLink);
      if (!caption.includes(hopLink)) {
        caption += `\n\n🔗 ${hopLink}`;
      }
      console.log(`[caption] Injected ClickBank HopLink for vendor: ${vendorId}`);
      return caption;
    }
  }

  // Fall back to direct affiliate links from .env
  if (affiliate && affiliate !== 'none') {
    const envKey = `AFFILIATE_${affiliate.toUpperCase().replace(/-/g, '_')}_LINK`;
    const link = process.env[envKey];
    if (link) {
      caption = caption.replace(/\[AFFILIATE_LINK\]/g, link);
      if (!caption.includes(link)) {
        caption += `\n\n🔗 ${link}`;
      }
      console.log(`[caption] Injected affiliate link for: ${affiliate}`);
    }
  }

  return caption;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function postNextInQueue() {
  loadEnv();

  if (!fs.existsSync(POSTED_DIR)) fs.mkdirSync(POSTED_DIR, { recursive: true });

  const queue = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.mp4')).sort();
  if (!queue.length) {
    console.log('[post] Queue is empty.');
    return;
  }

  const videoFile  = queue[0];
  const base       = path.basename(videoFile, '.mp4');
  const videoPath  = path.join(QUEUE_DIR, videoFile);
  const scriptPath = path.join(SCRIPTS_DIR, `${base}.json`);

  const script = fs.existsSync(scriptPath)
    ? JSON.parse(fs.readFileSync(scriptPath, 'utf8'))
    : {};

  const caption = await buildCaption(script);

  console.log(`\n[post] Next in queue: ${videoFile}`);
  console.log(`[post] Caption (${caption.length} chars): ${caption.slice(0, 100)}...`);
  if (DRY_RUN) console.log('[post] --- DRY RUN MODE ---');

  // Upload to R2 once — all platforms pull from same URL
  const videoUrl = DRY_RUN
    ? `https://example.r2.dev/${videoFile}`
    : await uploadVideo(videoPath, videoFile);

  console.log(`[post] Video URL: ${videoUrl}`);

  const results = {};

  // Instagram (+ Facebook cross-post via cross_post_to_fb_page_id)
  try {
    results.instagram = await postInstagram(videoUrl, caption);
  } catch (err) {
    console.error(`[instagram] ERROR: ${err.message}`);
    results.instagram = null;
  }

  // Facebook standalone (explicit Reels post — catches cases cross-post misses)
  try {
    results.facebook = await postFacebook(videoUrl, caption);
  } catch (err) {
    console.error(`[facebook] ERROR: ${err.message}`);
    results.facebook = null;
  }

  // TikTok
  try {
    results.tiktok = await postTikTok(videoUrl, caption);
  } catch (err) {
    console.error(`[tiktok] ERROR: ${err.message}`);
    results.tiktok = null;
  }

  // Move to posted (skip in dry run)
  if (!DRY_RUN) {
    fs.renameSync(videoPath, path.join(POSTED_DIR, videoFile));
  }

  console.log('\n[post] Results:');
  console.log(`  Instagram: ${results.instagram || 'failed'}`);
  console.log(`  Facebook:  ${results.facebook  || 'skipped/failed'}`);
  console.log(`  TikTok:    ${results.tiktok    || 'skipped/failed'}`);
  if (!DRY_RUN) console.log(`  Moved to posted/: ${videoFile}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

postNextInQueue().catch(err => {
  console.error('[post] Fatal:', err.message);
  process.exit(1);
});
