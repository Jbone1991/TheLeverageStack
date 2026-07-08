'use strict';
/**
 * The Leverage Stack — Queue Health Check
 *
 * Reads content/queue-manifest.json and reports how much runway is left.
 * Used by the daily-post GitHub Actions workflow to warn before the queue
 * runs dry (silent empty-queue was how cloud posting sat broken unnoticed).
 *
 * States:
 *   ok    — more than LOW_THRESHOLD videos pending
 *   low   — 1..LOW_THRESHOLD pending (refill soon)
 *   empty — 0 pending (nothing left to post)
 *
 * Usage:
 *   node automation/queue-health.js
 *
 * In CI it appends `pending=<n>` and `state=<ok|low|empty>` to $GITHUB_OUTPUT
 * so later steps can decide whether to open a refill issue.
 */

const fs   = require('fs');
const path = require('path');

const LOW_THRESHOLD = 5;
const MANIFEST_PATH = path.join(__dirname, '..', 'content', 'queue-manifest.json');

function readPending() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  return Array.isArray(manifest.pending) ? manifest.pending : [];
}

function classify(pending) {
  if (pending == null) return { pending: 0, state: 'empty', reason: 'no manifest' };
  const n = pending.length;
  if (n === 0) return { pending: 0, state: 'empty' };
  if (n <= LOW_THRESHOLD) return { pending: n, state: 'low' };
  return { pending: n, state: 'ok' };
}

function main() {
  const pending = readPending();
  const result = classify(pending);
  const next = pending && pending[0] ? pending[0].file : '(none)';

  console.log(`[queue-health] pending=${result.pending} state=${result.state} next=${next}`);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `pending=${result.pending}\nstate=${result.state}\nnext=${next}\n`
    );
  }
  return result;
}

if (require.main === module) main();

module.exports = { classify, LOW_THRESHOLD };
