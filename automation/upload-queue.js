'use strict';
/**
 * The Leverage Stack — Queue Pre-Uploader
 *
 * Uploads every MP4 in content/queue/ to R2 ahead of time and records them in
 * content/queue-manifest.json. The GitHub Actions daily-post workflow reads
 * that manifest to publish from the cloud, so the local machine's network
 * only matters when this script runs — not at 6 PM post time.
 *
 * Run on a good connection whenever new videos are rendered, then commit and
 * push the manifest:
 *
 *   node automation/upload-queue.js
 *   git add content/queue-manifest.json && git commit -m "chore: queue videos" && git push
 */

const fs = require('fs');
const path = require('path');
const { uploadVideo } = require('./upload-r2');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'content', 'queue');
const MANIFEST_PATH = path.join(ROOT, 'content', 'queue-manifest.json');

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { pending: [], posted: [] };
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

async function main() {
  const manifest = loadManifest();
  const known = new Set([
    ...manifest.pending.map(e => e.file),
    ...manifest.posted.map(e => e.file),
  ]);

  const queued = fs.existsSync(QUEUE_DIR)
    ? fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.mp4')).sort()
    : [];
  const fresh = queued.filter(f => !known.has(f));

  if (!fresh.length) {
    console.log('[upload-queue] Nothing new — manifest already covers all queued videos.');
    console.log(`[upload-queue] Pending: ${manifest.pending.length}, posted: ${manifest.posted.length}`);
    return;
  }

  console.log(`[upload-queue] Uploading ${fresh.length} new video(s) to R2...\n`);

  for (const file of fresh) {
    const url = await uploadVideo(path.join(QUEUE_DIR, file), file);
    manifest.pending.push({ file, url, uploaded: new Date().toISOString() });
  }

  // Keep pending in filename order so day-03 posts before day-04.
  manifest.pending.sort((a, b) => a.file.localeCompare(b.file));

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n[upload-queue] Manifest updated: ${manifest.pending.length} pending.`);
  console.log('[upload-queue] Now commit and push so the cloud workflow sees it:');
  console.log('  git add content/queue-manifest.json && git commit -m "chore: queue videos" && git push');
}

main().catch(err => {
  console.error('[upload-queue] Error:', err.message);
  process.exit(1);
});
