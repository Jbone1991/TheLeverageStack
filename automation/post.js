/**
 * The Leverage Stack — Meta Graph API Poster
 *
 * Posts videos from content/queue/ to Instagram as Reels,
 * then cross-posts to Facebook page automatically via Meta Business Suite.
 *
 * Requires: META_ACCESS_TOKEN, INSTAGRAM_ACCOUNT_ID in .env
 */

const fs = require('fs');
const path = require('path');
const { uploadVideo } = require('./upload-r2');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'content', 'queue');
const POSTED_DIR = path.join(ROOT, 'content', 'posted');
const SCRIPTS_DIR = path.join(ROOT, 'content', 'scripts');

const ENV_PATH = path.join(ROOT, '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('[post] .env file missing.');
    process.exit(1);
  }
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

async function graphApi(method, endpoint, body = null) {
  const token = process.env.META_ACCESS_TOKEN;
  const base = 'https://graph.facebook.com/v21.0';
  const url = `${base}${endpoint}${endpoint.includes('?') ? '&' : '?'}access_token=${token}`;

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  const res = await fetch(url, {
    ...opts,
    body: body ? JSON.stringify(body) : undefined
  });

  const json = await res.json();
  if (json.error) throw new Error(`Graph API error: ${JSON.stringify(json.error)}`);
  return json;
}

async function uploadVideoContainer(videoUrl, caption) {
  const igId = process.env.INSTAGRAM_ACCOUNT_ID;

  // Step 1: Create container
  const container = await graphApi('POST', `/${igId}/media`, {
    video_url: videoUrl,
    media_type: 'REELS',
    caption,
    share_to_feed: true
  });

  console.log(`[post] Container created: ${container.id}`);

  // Step 2: Poll until container is ready
  let status = 'IN_PROGRESS';
  let attempts = 0;
  while (status !== 'FINISHED' && attempts < 30) {
    await new Promise(r => setTimeout(r, 10000));
    const check = await graphApi('GET', `/${container.id}?fields=status_code`);
    status = check.status_code;
    console.log(`[post] Container status: ${status} (attempt ${++attempts})`);
    if (status === 'ERROR') throw new Error('Container processing failed on Meta side.');
  }

  // Step 3: Publish
  const publish = await graphApi('POST', `/${igId}/media_publish`, {
    creation_id: container.id
  });

  console.log(`[post] Published! Media ID: ${publish.id}`);
  return publish.id;
}

async function postNextInQueue() {
  loadEnv();

  if (!fs.existsSync(POSTED_DIR)) fs.mkdirSync(POSTED_DIR, { recursive: true });

  const queue = fs.readdirSync(QUEUE_DIR)
    .filter(f => f.endsWith('.mp4'))
    .sort();

  if (!queue.length) {
    console.log('[post] Queue is empty. Nothing to post.');
    return;
  }

  const videoFile = queue[0];
  const base = path.basename(videoFile, '.mp4');
  const videoPath = path.join(QUEUE_DIR, videoFile);
  const scriptPath = path.join(SCRIPTS_DIR, `${base}.json`);

  let caption = '#aitools #wealthbuilding #passiveincome #financialfreedom #theleveragestack';
  if (fs.existsSync(scriptPath)) {
    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    if (script.caption) caption = script.caption;
  }

  // Upload to Cloudflare R2 first — Meta requires a public URL, not a local file
  const videoUrl = await uploadVideo(videoPath, videoFile);

  console.log(`\n[post] Posting: ${videoFile}`);
  console.log(`[post] Caption preview: ${caption.slice(0, 80)}...`);

  const mediaId = await uploadVideoContainer(videoUrl, caption);

  // Move to posted
  fs.renameSync(videoPath, path.join(POSTED_DIR, videoFile));
  console.log(`[post] Done. Moved to posted/. Media ID: ${mediaId}`);
}

postNextInQueue().catch(err => {
  console.error('[post] Fatal:', err.message);
  process.exit(1);
});
