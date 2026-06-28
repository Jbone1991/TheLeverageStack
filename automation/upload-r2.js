/**
 * The Leverage Stack — Cloudflare R2 Uploader
 *
 * Uploads an MP4 from content/queue/ to R2 and returns the public URL.
 * Uses S3-compatible API with AWS SDK v3 (no AWS account needed).
 *
 * Required .env keys:
 *   R2_ACCOUNT_ID     — Cloudflare Account ID (from dash.cloudflare.com, top-right)
 *   R2_ACCESS_KEY_ID  — R2 API token Access Key ID
 *   R2_SECRET_ACCESS_KEY — R2 API token Secret Access Key
 *   R2_BUCKET_NAME    — bucket name (e.g. "leverage-stack")
 *   VIDEO_PUBLIC_URL_BASE — public bucket URL (e.g. https://pub-xxx.r2.dev/leverage-stack)
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('[r2] .env missing'); process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });
}

async function uploadVideo(localPath, remoteName) {
  loadEnv();
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME;
  const urlBase = process.env.VIDEO_PUBLIC_URL_BASE;

  const body = fs.readFileSync(localPath);
  const key = remoteName || path.basename(localPath);

  console.log(`[r2] Uploading ${key} to ${bucket}...`);

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'video/mp4'
  }));

  const publicUrl = `${urlBase}/${key}`;
  console.log(`[r2] Done: ${publicUrl}`);
  return publicUrl;
}

module.exports = { uploadVideo };

// CLI usage: node automation/upload-r2.js path/to/video.mp4
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node automation/upload-r2.js <path-to-mp4>');
    process.exit(1);
  }
  uploadVideo(filePath).catch(err => {
    console.error('[r2] Error:', err.message);
    process.exit(1);
  });
}
