#!/usr/bin/env node
/**
 * deploy-webstore.js — Automated Chrome Web Store API v2 uploader & publisher.
 * Reads credentials from environment variables or .env.webstore.
 * Zero external dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Load .env.webstore if present
const envPath = path.join(ROOT, '.env.webstore');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const CLIENT_ID = process.env.CHROME_CLIENT_ID;
const CLIENT_SECRET = process.env.CHROME_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.CHROME_REFRESH_TOKEN;
const PUBLISHER_ID = process.env.CHROME_PUBLISHER_ID;
const EXTENSION_ID = process.env.CHROME_EXTENSION_ID;
const ZIP_PATH = process.env.CHROME_ZIP_PATH || path.join(ROOT, 'dist', 'pinvault-pinterest-downloader-1.0.0.zip');

function request(url, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(u, {
      method: options.method || 'GET',
      rejectUnauthorized: false,
      headers: options.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`[${res.statusCode}] ${json.error?.message || json.error_description || body}`));
        } catch {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else reject(new Error(`[${res.statusCode}] ${body}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getAccessToken() {
  const postData = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }).toString();

  const res = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
    },
  }, postData);

  return res.access_token;
}

async function uploadZip(token, zipBuffer) {
  console.log(`Uploading ${ZIP_PATH} (${zipBuffer.length} bytes) to Chrome Web Store API v2...`);
  const uploadUrl = `https://chromewebstore.googleapis.com/upload/v2/publishers/${PUBLISHER_ID}/items/${EXTENSION_ID}:upload`;
  const res = await request(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/zip',
      'Content-Length': zipBuffer.length,
    },
  }, zipBuffer);
  return res;
}

async function publishItem(token) {
  console.log(`Submitting item ${EXTENSION_ID} for review / publishing...`);
  const publishUrl = `https://chromewebstore.googleapis.com/v2/publishers/${PUBLISHER_ID}/items/${EXTENSION_ID}:publish`;
  const res = await request(publishUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Length': 0,
    },
  });
  return res;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('Missing OAuth credentials. Run `node scripts/get-refresh-token.js` first.');
    process.exit(1);
  }

  if (!PUBLISHER_ID || !EXTENSION_ID) {
    console.log('\n========================================================================');
    console.log('NOTE: Initial Extension Registration Required in Dashboard');
    console.log('========================================================================');
    console.log('To deploy via API, Google requires the extension to be created once in the');
    console.log('Chrome Web Store Developer Console to obtain your Publisher ID and Item ID.');
    console.log('\n1. Open: https://chrome.google.com/webstore/devconsole');
    console.log('2. Click "New Item" and upload: ' + ZIP_PATH);
    console.log('3. Copy your Publisher ID and Extension ID (from the dashboard URL or item details).');
    console.log('4. Add them to .env.webstore or pass as environment variables:');
    console.log('   CHROME_PUBLISHER_ID=your_publisher_id');
    console.log('   CHROME_EXTENSION_ID=your_extension_id');
    console.log('========================================================================\n');
    process.exit(0);
  }

  if (!fs.existsSync(ZIP_PATH)) {
    console.error(`ZIP file not found at ${ZIP_PATH}. Run scripts/build.ps1 first.`);
    process.exit(1);
  }

  console.log('Refreshing Google access token...');
  const token = await getAccessToken();
  console.log('Access token obtained.');

  const zipBuffer = fs.readFileSync(ZIP_PATH);
  const uploadRes = await uploadZip(token, zipBuffer);
  console.log('Upload result:', uploadRes);

  if (process.argv.includes('--publish')) {
    const publishRes = await publishItem(token);
    console.log('Publish result:', publishRes);
  } else {
    console.log('\nPackage uploaded as draft. To publish immediately, pass `--publish`.');
  }
}

main().catch((err) => {
  console.error('Deployment error:', err.message);
  process.exit(1);
});
