/**
 * The Leverage Stack — Website deployer
 *
 * Uploads every file in web/ to the R2 bucket that backs theleveragestack.co.
 * The bare-root request (theleveragestack.co/) is rewritten to index.html by a
 * Cloudflare Transform Rule; every other page is served at its explicit path
 * (e.g. /guides.html), which is why the site uses .html links throughout.
 *
 * Usage:  node automation/deploy-site.js
 */

const fs = require('fs');
const path = require('path');
const { uploadFile } = require('./upload-r2');

const WEB_DIR = path.resolve(__dirname, '..', 'web');

// File extensions we publish. Anything else in web/ is ignored.
const PUBLISH_EXT = new Set(['.html', '.css', '.js', '.txt', '.png', '.jpg', '.svg', '.ico']);

async function main() {
  if (!fs.existsSync(WEB_DIR)) {
    console.error(`[deploy] web/ not found at ${WEB_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(WEB_DIR)
    .filter(f => PUBLISH_EXT.has(path.extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.error('[deploy] nothing to publish in web/');
    process.exit(1);
  }

  console.log(`[deploy] publishing ${files.length} file(s) from web/ to R2...\n`);

  let ok = 0;
  for (const file of files) {
    try {
      // remoteName === file keeps paths flat at the bucket root (/guides.html, /style.css, ...)
      await uploadFile(path.join(WEB_DIR, file), file);
      ok++;
    } catch (err) {
      console.error(`[deploy] FAILED ${file}: ${err.message}`);
    }
  }

  console.log(`\n[deploy] done — ${ok}/${files.length} uploaded.`);
  console.log('[deploy] live at https://theleveragestack.co/');
  if (ok !== files.length) process.exit(1);
}

main().catch(err => {
  console.error('[deploy] Error:', err.message);
  process.exit(1);
});
