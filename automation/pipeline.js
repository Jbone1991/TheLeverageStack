/**
 * The Leverage Stack — Content Pipeline Orchestrator
 *
 * Flow: Script → Voiceover → Video Assembly → Queue → Post
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'channel.json'), 'utf8'));
const SCRIPTS_DIR = path.join(ROOT, 'content', 'scripts');
const RENDERED_DIR = path.join(ROOT, 'content', 'rendered');
const QUEUE_DIR = path.join(ROOT, 'content', 'queue');
const AUDIO_DIR = path.join(ROOT, 'assets', 'audio');

// Load env — never commit .env
const ENV_PATH = path.join(ROOT, '.env');
function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('[pipeline] .env file missing. Copy .env.example and fill in keys.');
    process.exit(1);
  }
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

async function generateVoiceover(scriptPath, outputPath) {
  const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const text = script.voiceover_text;

  const body = {
    text,
    model_id: CONFIG.voice.model,
    voice_settings: {
      stability: CONFIG.voice.stability,
      similarity_boost: CONFIG.voice.similarity_boost
    }
  };

  const voiceId = process.env.ELEVENLABS_VOICE_ID || CONFIG.voice.voice_id;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs error: ${response.status} ${await response.text()}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`[pipeline] Voiceover saved: ${path.basename(outputPath)}`);
}

function assembleVideo(scriptPath, audioPath, outputPath) {
  const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg';

  // Dark ambient background — use a bundled loop or downloaded stock clip
  const bgPath = path.join(ROOT, 'assets', 'backgrounds', script.background || 'default_dark.mp4');

  if (!fs.existsSync(bgPath)) {
    console.warn(`[pipeline] Background not found: ${bgPath}. Using color plate fallback.`);
  }

  // Build FFmpeg drawtext filter for hook + body lines
  const hook = script.hook_text.replace(/'/g, "’");
  const body = (script.body_text || '').replace(/'/g, "’");

  const bg = fs.existsSync(bgPath)
    ? `-stream_loop -1 -i "${bgPath}"`
    : `-f lavfi -i color=c=0x0A0A0F:size=1080x1920:rate=30`;

  const drawtext = [
    `drawtext=text='${hook}':fontcolor=white:fontsize=52:x=(w-text_w)/2:y=(h/2)-80:box=1:boxcolor=black@0.4:boxborderw=12`,
    body ? `drawtext=text='${body}':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=(h/2)+20:box=1:boxcolor=black@0.3:boxborderw=8` : null
  ].filter(Boolean).join(',');

  const cmd = [
    `"${ffmpegBin}"`,
    bg,
    `-i "${audioPath}"`,
    `-vf "${drawtext}"`,
    `-c:v libx264 -preset fast -crf 23`,
    `-c:a aac -b:a 128k`,
    `-t 60 -shortest`,
    `-y "${outputPath}"`
  ].join(' ');

  execSync(cmd, { stdio: 'inherit' });
  console.log(`[pipeline] Video assembled: ${path.basename(outputPath)}`);
}

async function processScript(scriptFile) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptFile);
  const base = path.basename(scriptFile, '.json');
  const audioPath = path.join(AUDIO_DIR, `${base}.mp3`);
  const videoPath = path.join(RENDERED_DIR, `${base}.mp4`);
  const queuePath = path.join(QUEUE_DIR, `${base}.mp4`);

  if (fs.existsSync(queuePath)) {
    console.log(`[pipeline] Already queued: ${base}`);
    return;
  }

  console.log(`\n[pipeline] Processing: ${base}`);
  await generateVoiceover(scriptPath, audioPath);
  assembleVideo(scriptPath, audioPath, videoPath);
  fs.renameSync(videoPath, queuePath);
  console.log(`[pipeline] Queued for posting: ${base}`);
}

async function run() {
  loadEnv();

  const args = process.argv.slice(2);
  const target = args[0]; // optional: specific script filename

  const scripts = target
    ? [target]
    : fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.json')).sort();

  if (!scripts.length) {
    console.log('[pipeline] No scripts found in content/scripts/');
    return;
  }

  for (const script of scripts) {
    await processScript(script);
  }

  console.log('\n[pipeline] Done. Videos ready in content/queue/');
}

run().catch(err => {
  console.error('[pipeline] Fatal:', err.message);
  process.exit(1);
});
