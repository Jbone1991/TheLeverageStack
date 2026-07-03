'use strict';
/**
 * The Leverage Stack — Meta Long-Lived Token Exchange
 *
 * Exchanges your short-lived User Access Token (from Graph API Explorer)
 * for a 60-day long-lived token. Writes it back to .env automatically.
 *
 * Usage:
 *   1. Generate a fresh token in Graph API Explorer
 *   2. Paste it into .env as META_ACCESS_TOKEN
 *   3. Run: node automation/meta-refresh-token.js
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ROOT     = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

function loadEnv() {
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

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function run() {
  loadEnv();

  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const shortToken = process.env.META_ACCESS_TOKEN;

  if (!appId || !appSecret) {
    console.error('[meta-token] META_APP_ID and META_APP_SECRET must be set in .env');
    process.exit(1);
  }
  if (!shortToken) {
    console.error('[meta-token] META_ACCESS_TOKEN must be set in .env (paste fresh token from Graph API Explorer)');
    process.exit(1);
  }

  console.log('[meta-token] Exchanging short-lived token for 60-day long-lived token...');

  const url = `https://graph.facebook.com/v21.0/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${appId}` +
    `&client_secret=${appSecret}` +
    `&fb_exchange_token=${shortToken}`;

  const data = await httpsGet(url);

  if (data.error) {
    console.error('[meta-token] Exchange failed:', JSON.stringify(data.error, null, 2));
    process.exit(1);
  }

  const { access_token, expires_in, token_type } = data;
  const days = Math.round((expires_in || 5183944) / 86400);

  updateEnv('META_ACCESS_TOKEN', access_token);
  console.log(`[meta-token] Success! Long-lived token written to .env`);
  console.log(`[meta-token] Type: ${token_type} — expires in ~${days} days`);
}

run().catch(err => {
  console.error('[meta-token] Fatal:', err.message);
  process.exit(1);
});
