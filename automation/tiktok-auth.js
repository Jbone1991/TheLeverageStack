'use strict';
/**
 * The Leverage Stack — TikTok OAuth Helper
 *
 * Run once to get your access token and open_id.
 * Writes TIKTOK_ACCESS_TOKEN and TIKTOK_OPEN_ID to .env automatically.
 *
 * Usage:
 *   node automation/tiktok-auth.js
 *
 * Requires in .env:
 *   TIKTOK_CLIENT_KEY=...
 *   TIKTOK_CLIENT_SECRET=...
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) { console.error('[tiktok-auth] .env not found'); process.exit(1); }
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

function updateEnv(key, value) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(body).toString();
    const opts = {
      hostname, path, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  loadEnv();

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || clientKey === 'NEEDS_SETUP') {
    console.error('[tiktok-auth] TIKTOK_CLIENT_KEY not set in .env');
    process.exit(1);
  }

  const redirectUri = 'https://jbone1991.github.io/TheLeverageStack/callback.html';
  const scope = 'user.info.basic,video.publish';
  const csrfState = Math.random().toString(36).slice(2);

  const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${scope}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${csrfState}`;

  console.log('\n[tiktok-auth] Opening TikTok authorization page...');
  console.log('[tiktok-auth] Log in with your TikTok account and approve access.\n');
  try { execSync('start "" "' + authUrl + '"'); } catch {
    console.log('[tiktok-auth] Could not auto-open browser. Open this URL manually:\n' + authUrl);
  }

  console.log('[tiktok-auth] After approving, the browser will show your authorization code.');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise(resolve => rl.question('[tiktok-auth] Paste the code here: ', ans => { rl.close(); resolve(ans.trim()); }));

  if (!code) { console.error('[tiktok-auth] No code entered.'); process.exit(1); }

  console.log('[tiktok-auth] Exchanging code for access token...');

  const data = await httpsPost('open.tiktokapis.com', '/v2/oauth/token/', {
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  if (data.error) {
    console.error('[tiktok-auth] Token exchange failed:', data.error, data.error_description);
    process.exit(1);
  }

  const { access_token, open_id, expires_in, refresh_token } = data;

  updateEnv('TIKTOK_ACCESS_TOKEN', access_token);
  updateEnv('TIKTOK_OPEN_ID', open_id);
  if (refresh_token) updateEnv('TIKTOK_REFRESH_TOKEN', refresh_token);

  console.log('[tiktok-auth] Success!');
  console.log('  open_id:    ' + open_id);
  console.log('  expires_in: ' + expires_in + 's (~' + Math.round(expires_in / 86400) + ' days)');
  console.log('[tiktok-auth] TIKTOK_ACCESS_TOKEN and TIKTOK_OPEN_ID written to .env');
}

run().catch(err => {
  console.error('[tiktok-auth] Fatal:', err.message);
  process.exit(1);
});
