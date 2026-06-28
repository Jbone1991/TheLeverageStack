/**
 * The Leverage Stack — Pipeline Status Check
 * Run: node automation/status.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = {
  scripts: path.join(ROOT, 'content', 'scripts'),
  queue: path.join(ROOT, 'content', 'queue'),
  rendered: path.join(ROOT, 'content', 'rendered'),
  posted: path.join(ROOT, 'content', 'posted'),
  audio: path.join(ROOT, 'assets', 'audio')
};

function countFiles(dir, ext) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => f.endsWith(ext)).length;
}

const scripts = countFiles(DIRS.scripts, '.json');
const audio = countFiles(DIRS.audio, '.mp3');
const queued = countFiles(DIRS.queue, '.mp4');
const posted = countFiles(DIRS.posted, '.mp4');

console.log('\n=== The Leverage Stack — Pipeline Status ===\n');
console.log(`Scripts written:   ${scripts} / 30`);
console.log(`Voiceovers done:   ${audio}`);
console.log(`Ready to post:     ${queued}`);
console.log(`Posted:            ${posted}`);
console.log(`\nDays of content remaining: ${queued} (${Math.round(queued / 5 * 10) / 10} weeks)`);

if (queued === 0) {
  console.log('\n[!] Queue is empty — run: node automation/pipeline.js');
} else if (queued < 5) {
  console.log('\n[!] Less than 1 week of content queued — run pipeline soon.');
}

console.log('');
