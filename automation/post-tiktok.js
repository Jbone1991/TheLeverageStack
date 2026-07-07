'use strict';
/**
 * The Leverage Stack — TikTok Video Poster
 *
 * Posts the next queued video to TikTok using the Content Posting API.
 * Uses Direct Post (goes live immediately, no draft step).
 *
 * Usage:
 *   node automation/post-tiktok.js            — post next in queue
 *   node automation/post-tiktok.js day-02.mp4 — post specific file
 *
 * Requires in .env:
 *   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
 *   TIKTOK_ACCESS_TOKEN, TIKTOK_OPEN_ID
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'content', 'queue');
const POSTED_DIR = path.join(ROOT, 'content', 'posted');
const ENV_PATH = path.join(ROOT, '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) { console.error('[tiktok] .env not found'); process.exit(1); }
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

function httpsRequest(method, hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, path: urlPath, method, headers };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Upload file bytes to the TikTok upload URL (PUT request)
function uploadFile(uploadUrl, filePath) {
  return new Promise((resolve, reject) => {
    const fileSize = fs.statSync(filePath).size;
    const fileStream = fs.createReadStream(filePath);
    const url = new URL(uploadUrl);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': fileSize,
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
      },
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    fileStream.pipe(req);
  });
}

async function run() {
  loadEnv();

  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  const openId = process.env.TIKTOK_OPEN_ID;

  if (!accessToken || accessToken === 'NEEDS_SETUP') {
    console.error('[tiktok] TIKTOK_ACCESS_TOKEN not set. Run: node automation/tiktok-auth.js');
    process.exit(1);
  }

  // Pick video to post
  const arg = process.argv[2];
  let videoFile;
  if (arg) {
    videoFile = path.isAbsolute(arg) ? arg : path.join(QUEUE_DIR, arg);
  } else {
    const queued = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.mp4')).sort();
    if (!queued.length) { console.log('[tiktok] Queue is empty.'); return; }
    videoFile = path.join(QUEUE_DIR, queued[0]);
  }

  if (!fs.existsSync(videoFile)) {
    console.error('[tiktok] File not found: ' + videoFile);
    process.exit(1);
  }

  const fileName = path.basename(videoFile);
  const fileSize = fs.statSync(videoFile).size;
  const base = path.basename(videoFile, '.mp4');

  // Load caption from script JSON if available
  let caption = 'AI tools and financial freedom. Follow for one tool every weekday. #aitools #passiveincome #financialfreedom #theleveragestack';
  const scriptPath = path.join(ROOT, 'content', 'scripts', base + '.json');
  if (fs.existsSync(scriptPath)) {
    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    if (script.caption) caption = script.caption;
  }

  console.log('[tiktok] Posting: ' + fileName + ' (' + (fileSize / 1e6).toFixed(1) + ' MB)');

  // Step 1: Initialize upload
  const initPayload = {
    post_info: {
      title: caption.slice(0, 2200),
      // Sandbox/unaudited apps may only post privately — set TIKTOK_PRIVACY=SELF_ONLY in .env for the demo.
      privacy_level: process.env.TIKTOK_PRIVACY || 'PUBLIC_TO_EVERYONE',
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
    },
    source_info: {
      source: 'FILE_UPLOAD',
      video_size: fileSize,
      chunk_size: fileSize,
      total_chunk_count: 1,
    },
  };

  const initRes = await httpsRequest(
    'POST',
    'open.tiktokapis.com',
    '/v2/post/publish/video/init/',
    {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    initPayload
  );

  if (initRes.status !== 200 || initRes.body.error?.code !== 'ok') {
    console.error('[tiktok] Init failed:', JSON.stringify(initRes.body, null, 2));
    process.exit(1);
  }

  const { publish_id, upload_url } = initRes.body.data;
  console.log('[tiktok] publish_id: ' + publish_id);
  console.log('[tiktok] Uploading video...');

  // Step 2: Upload file
  const uploadRes = await uploadFile(upload_url, videoFile);
  if (uploadRes.status !== 200 && uploadRes.status !== 201) {
    console.error('[tiktok] Upload failed (HTTP ' + uploadRes.status + '):', uploadRes.body);
    process.exit(1);
  }
  console.log('[tiktok] Upload complete.');

  // Step 3: Poll for publish status
  console.log('[tiktok] Waiting for TikTok to process video...');
  let published = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await httpsRequest(
      'POST',
      'open.tiktokapis.com',
      '/v2/post/publish/status/fetch/',
      {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      { publish_id }
    );

    const s = statusRes.body?.data?.status;
    console.log('[tiktok] Status: ' + s);

    if (s === 'PUBLISH_COMPLETE') { published = true; break; }
    if (s === 'FAILED') {
      console.error('[tiktok] Publish failed:', JSON.stringify(statusRes.body, null, 2));
      process.exit(1);
    }
  }

  if (!published) {
    console.warn('[tiktok] Timed out waiting for publish confirmation — check TikTok manually.');
    return;
  }

  // Move to posted/
  fs.mkdirSync(POSTED_DIR, { recursive: true });
  const dest = path.join(POSTED_DIR, fileName);
  fs.renameSync(videoFile, dest);
  console.log('[tiktok] Posted successfully. Moved to content/posted/' + fileName);
}

run().catch(err => {
  console.error('[tiktok] Fatal:', err.message);
  process.exit(1);
});
