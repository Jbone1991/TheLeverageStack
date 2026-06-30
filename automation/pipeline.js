/**
 * The Leverage Stack - Content Pipeline Orchestrator
 *
 * Flow: Script -> Voiceover -> Video Assembly -> Queue -> Post
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const voiceover = require('./voiceover');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'channel.json'), 'utf8'));
const SCRIPTS_DIR = path.join(ROOT, 'content', 'scripts');
const RENDERED_DIR = path.join(ROOT, 'content', 'rendered');
const QUEUE_DIR = path.join(ROOT, 'content', 'queue');
const AUDIO_DIR = path.join(ROOT, 'assets', 'audio');
const BG_DIR = path.join(ROOT, 'assets', 'backgrounds');
const FONTS_DIR = path.join(ROOT, 'assets', 'fonts');
const TMP_DIR = path.join(ROOT, 'assets', 'tmp');

// Relative font path (no drive letter = no colon escaping needed in FFmpeg filters)
const FONT_REL = 'assets/fonts/arialbd.ttf';

// --- Text helpers ---

// Normalize smart/curly quotes to ASCII. No FFmpeg escaping needed since we use textfile=.
function normalizeText(str) {
  return (str || '')
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"');
}

// Word-wrap to an array of lines.
function wrapLines(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) { line = word; continue; }
    if ((line + ' ' + word).length <= maxChars) {
      line += ' ' + word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Pick background based on current season, falling back to default_dark.
function getSeasonBackground() {
  const m = new Date().getMonth();
  const seasonal = m >= 2 && m <= 4 ? 'spring.mp4'
    : m >= 5 && m <= 7 ? 'summer.mp4'
    : m >= 8 && m <= 10 ? 'fall.mp4'
    : 'winter.mp4';
  if (fs.existsSync(path.join(BG_DIR, seasonal))) return seasonal;
  if (fs.existsSync(path.join(BG_DIR, 'city_night.mp4'))) return 'city_night.mp4';
  return 'default_dark.mp4';
}

// Load env -- never commit .env
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

async function ensureVoiceover(scriptName, outputPath) {
  if (fs.existsSync(outputPath)) {
    console.log('[pipeline] Audio exists, skipping voiceover: ' + path.basename(outputPath));
    return;
  }
  await voiceover.generate(scriptName);
}

function assembleVideo(scriptPath, audioPath, outputPath, base) {
  const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg';

  // Ensure tmp dir exists
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Write text to files -- avoids all shell/FFmpeg escaping issues entirely
  const hookLines = wrapLines(normalizeText(script.hook_text), 20);
  const bodyLines = script.body_text ? wrapLines(normalizeText(script.body_text), 26) : [];
  const ctaText = normalizeText(script.cta_overlay || CONFIG.cta_overlay || 'Follow for more AI tools every Weekday');
  const hookFile = path.join(TMP_DIR, base + '-hook.txt');
  const bodyFile = path.join(TMP_DIR, base + '-body.txt');
  const ctaFile = path.join(TMP_DIR, base + '-cta.txt');
  fs.writeFileSync(hookFile, hookLines.join('\n'), 'utf8');
  if (bodyLines.length) fs.writeFileSync(bodyFile, bodyLines.join('\n'), 'utf8');
  fs.writeFileSync(ctaFile, ctaText, 'utf8');

  // Relative paths from ROOT (no drive letter, no colon, no escaping needed)
  const hookRel = 'assets/tmp/' + base + '-hook.txt';
  const bodyRel = 'assets/tmp/' + base + '-body.txt';
  const ctaRel = 'assets/tmp/' + base + '-cta.txt';

  // Background: script override -> seasonal -> color plate fallback
  const bgFile = (() => {
    if (script.background && script.background !== 'default_dark.mp4') {
      if (fs.existsSync(path.join(BG_DIR, script.background))) return script.background;
    }
    return getSeasonBackground();
  })();
  const bgPath = path.join(BG_DIR, bgFile);

  const bg = fs.existsSync(bgPath)
    ? '-stream_loop -1 -i "' + bgPath + '"'
    : '-f lavfi -i color=c=0x0A0A0F:size=1080x1920:rate=30';

  const baseStyle = 'fontfile=' + FONT_REL + ':fontcolor=white:shadowcolor=black@0.9:shadowx=3:shadowy=3';
  const ctaStyle = 'fontfile=' + FONT_REL + ':fontcolor=white:shadowcolor=black@0.95:shadowx=2:shadowy=2:box=1:boxcolor=black@0.45:boxborderw=14';

  const filters = [
    'drawtext=' + baseStyle + ':textfile=' + hookRel + ':fontsize=62:x=(w-text_w)/2:y=h*0.36-text_h/2:line_spacing=10',
    bodyLines.length ? 'drawtext=' + baseStyle + ':textfile=' + bodyRel + ':fontsize=42:x=(w-text_w)/2:y=h*0.62-text_h/2:line_spacing=8' : null,
    'drawtext=' + ctaStyle + ':textfile=' + ctaRel + ':fontsize=36:x=(w-text_w)/2:y=h*0.91-text_h/2'
  ].filter(Boolean).join(',');

  const cmd = [
    '"' + ffmpegBin + '"',
    bg,
    '-i "' + audioPath + '"',
    '-vf "' + filters + '"',
    '-c:v libx264 -preset fast -crf 23',
    '-c:a aac -b:a 128k',
    '-t 60 -shortest',
    '-y "' + outputPath + '"'
  ].join(' ');

  console.log('[pipeline] Background: ' + bgFile);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
  console.log('[pipeline] Video assembled: ' + path.basename(outputPath));
}

async function processScript(scriptFile) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptFile);
  const base = path.basename(scriptFile, '.json');
  const audioPath = path.join(AUDIO_DIR, base + '.mp3');
  const videoPath = path.join(RENDERED_DIR, base + '.mp4');
  const queuePath = path.join(QUEUE_DIR, base + '.mp4');

  if (fs.existsSync(queuePath)) {
    console.log('[pipeline] Already queued: ' + base);
    return;
  }

  console.log('\n[pipeline] Processing: ' + base);
  await ensureVoiceover(base, audioPath);
  assembleVideo(scriptPath, audioPath, videoPath, base);
  fs.renameSync(videoPath, queuePath);
  console.log('[pipeline] Queued for posting: ' + base);
}

async function run() {
  loadEnv();

  const args = process.argv.slice(2);
  const target = args[0];

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
