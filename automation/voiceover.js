'use strict';
/**
 * The Leverage Stack — VoiceBox Voiceover Generator
 *
 * Reads a script JSON from content/scripts/, generates speech via the local
 * VoiceBox server, and saves the MP3 to assets/audio/.
 *
 * Usage:
 *   node automation/voiceover.js day-01          — generate single script
 *   node automation/voiceover.js                 — generate all pending scripts
 *
 * Env vars (all optional — defaults work if VoiceBox is running):
 *   VOICEBOX_HOST          default: 127.0.0.1
 *   VOICEBOX_PORT          default: 17493
 *   VOICEBOX_PROFILE_NAME  default: LeverageVoice
 *   VOICEBOX_ENGINE_TYPE   default: qwen
 *   VOICEBOX_MODEL         default: 1.7B
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');

const ROOT       = path.resolve(__dirname, '..');
const SCRIPTS    = path.join(ROOT, 'content', 'scripts');
const AUDIO_OUT  = path.join(ROOT, 'assets', 'audio');

const HOST         = process.env.VOICEBOX_HOST         || '127.0.0.1';
const PORT         = parseInt(process.env.VOICEBOX_PORT || '17493', 10);
const PROFILE_NAME = process.env.VOICEBOX_PROFILE_NAME || 'LeverageVoice';
const ENGINE       = process.env.VOICEBOX_ENGINE_TYPE  || 'qwen';
const MODEL        = process.env.VOICEBOX_MODEL        || '1.7B';
const POLL_MS      = 4000;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: HOST, port: PORT, path: urlPath, method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          reject(new Error(`VoiceBox ${method} ${urlPath} → HTTP ${res.statusCode}: ${raw.toString().slice(0, 300)}`));
        } else {
          try { resolve(JSON.parse(raw.toString())); } catch { resolve(raw); }
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function downloadAudio(urlPath, destPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: HOST, port: PORT, path: urlPath, method: 'GET' }, res => {
      if (res.statusCode >= 400) {
        let e = ''; res.on('data', c => e += c);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${e.slice(0, 200)}`)));
        return;
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => resolve(destPath));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── Core logic ───────────────────────────────────────────────────────────────

async function resolveProfileId(name) {
  const profiles = await apiRequest('GET', '/profiles');
  const match = profiles.find(p => p.name === name);
  if (!match) {
    const available = profiles.map(p => p.name).join(', ');
    throw new Error(`VoiceBox profile "${name}" not found. Available: ${available}`);
  }
  return match.id;
}

async function pollUntilDone(generationId) {
  let dots = 0;
  while (true) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const status = await apiRequest('GET', `/history/${generationId}`);
    const state = (status.status || status.state || 'unknown').toLowerCase();
    const dur = status.duration ? ` (${status.duration.toFixed(1)}s audio)` : '';
    process.stdout.write(`\r[voiceover] ${state}${dur} ${'·'.repeat((dots++ % 3) + 1)}   `);
    if (['complete', 'completed', 'done'].includes(state)) { process.stdout.write('\n'); return; }
    if (['error', 'failed'].includes(state)) {
      process.stdout.write('\n');
      throw new Error(`Generation failed: ${JSON.stringify(status)}`);
    }
  }
}

async function generateVoiceover(scriptName, profileId) {
  const scriptPath = path.join(SCRIPTS, `${scriptName}.json`);
  if (!fs.existsSync(scriptPath)) throw new Error(`Script not found: ${scriptPath}`);

  const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const text = script.voiceover_text;
  if (!text) throw new Error(`No voiceover_text in ${scriptName}.json`);

  const outPath = path.join(AUDIO_OUT, `${scriptName}.mp3`);
  if (fs.existsSync(outPath)) {
    console.log(`[voiceover] Already exists, skipping: ${scriptName}.mp3`);
    return outPath;
  }

  console.log(`[voiceover] Generating: ${scriptName} (${text.split(' ').length} words)`);

  const gen = await apiRequest('POST', '/generate', {
    profile_id:     profileId,
    text,
    engine:         ENGINE,
    model_size:     MODEL,
    language:       'en',
    max_chunk_chars: 600,
    crossfade_ms:   60,
    normalize:      true,
  });

  const generationId = gen.id || gen.generation_id;
  if (!generationId) throw new Error(`No generation ID returned: ${JSON.stringify(gen)}`);
  console.log(`[voiceover] Generation ID: ${generationId}`);

  await pollUntilDone(generationId);
  await downloadAudio(`/history/${generationId}/export-audio`, outPath);

  const sizeMB = (fs.statSync(outPath).size / 1e6).toFixed(2);
  console.log(`[voiceover] Saved: ${outPath} (${sizeMB} MB)`);
  return outPath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  // Load .env if present
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const [key, ...rest] = line.split('=');
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    }
  }

  if (!fs.existsSync(AUDIO_OUT)) fs.mkdirSync(AUDIO_OUT, { recursive: true });

  const arg = process.argv[2];

  // Determine which scripts to process
  let targets;
  if (arg) {
    // Single script — accept with or without .json extension
    targets = [arg.replace(/\.json$/, '')];
  } else {
    // All scripts that don't already have audio
    targets = fs.readdirSync(SCRIPTS)
      .filter(f => f.endsWith('.json') && !f.startsWith('test-'))
      .map(f => path.basename(f, '.json'))
      .filter(name => !fs.existsSync(path.join(AUDIO_OUT, `${name}.mp3`)))
      .sort();
  }

  if (!targets.length) {
    console.log('[voiceover] All scripts already have audio. Nothing to generate.');
    return;
  }

  console.log(`[voiceover] Profile: ${PROFILE_NAME} | Engine: ${ENGINE} | Model: ${MODEL}`);
  console.log(`[voiceover] Scripts to generate: ${targets.length}`);

  const profileId = await resolveProfileId(PROFILE_NAME);
  console.log(`[voiceover] Profile ID: ${profileId}\n`);

  for (const name of targets) {
    try {
      await generateVoiceover(name, profileId);
    } catch (err) {
      console.error(`[voiceover] ERROR on ${name}: ${err.message}`);
    }
  }

  console.log('\n[voiceover] Done.');
}

run().catch(err => {
  console.error(`[voiceover] Fatal: ${err.message}`);
  process.exit(1);
});
