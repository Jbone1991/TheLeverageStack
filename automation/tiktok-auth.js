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

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
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

  const redirectUri = 'http://localhost:3000/callback';
  const scope = 'user.info.basic,video.publish';
  const csrfState = Math.random().toString(36).slice(2);

  const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${scope}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${csrfState}`;

  console.log('\n[tiktok-auth] Open this URL in the browser where you are logged into your TikTok account:\n');
  console.log(authUrl);
  console.log('\n[tiktok-auth] After approving, you will be redirected to localhost:3000/callback');
  console.log('[tiktok-auth] Starting local server to capture the auth code...\n');

  // Start a local HTTP server to catch the redirect
  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:3000');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (!code) {
        res.writeHead(400); res.end('No auth code received.');
        return;
      }

      if (state !== csrfState) {
        res.writeHead(400); res.end('State mismatch — possible CSRF.');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2>Authenticated! You can close this tab and return to the terminal.</h2>');
      server.close();

      console.log('[tiktok-auth] Auth code received. Exchanging for access token...');

      try {
        const data = await httpsPost('open.tiktokapis.com', '/v2/oauth/token/', {
          client_key: clientKey,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        });

        if (data.error) {
          console.error('[tiktok-auth] Token exchange failed:', data.error, data.error_description);
          reject(new Error(data.error));
          return;
        }

        const { access_token, open_id, expires_in, refresh_token } = data;

        updateEnv('TIKTOK_ACCESS_TOKEN', access_token);
        updateEnv('TIKTOK_OPEN_ID', open_id);
        if (refresh_token) updateEnv('TIKTOK_REFRESH_TOKEN', refresh_token);

        console.log('[tiktok-auth] Success!');
        console.log('  open_id:    ' + open_id);
        console.log('  expires_in: ' + expires_in + 's (~' + Math.round(expires_in / 86400) + ' days)');
        console.log('[tiktok-auth] TIKTOK_ACCESS_TOKEN and TIKTOK_OPEN_ID written to .env');
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    server.listen(3000, () => {
      console.log('[tiktok-auth] Listening on http://localhost:3000/callback');
      // Try to auto-open in browser
      try { execSync('start "" "' + authUrl + '"'); } catch {}
    });

    server.on('error', reject);
  });
}

run().catch(err => {
  console.error('[tiktok-auth] Fatal:', err.message);
  process.exit(1);
});
