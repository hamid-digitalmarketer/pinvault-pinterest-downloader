#!/usr/bin/env node
/**
 * get-refresh-token.js
 *
 * Automated local OAuth2 loopback helper to obtain a Chrome Web Store API
 * refresh token using Google Cloud credentials.
 * Zero external dependencies.
 */
import http from 'node:http';
import https from 'node:https';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let CLIENT_ID = process.env.CHROME_CLIENT_ID;
let CLIENT_SECRET = process.env.CHROME_CLIENT_SECRET;

// Auto-detect client_secret JSON file if env vars not set
if (!CLIENT_ID || !CLIENT_SECRET) {
  const candidates = [
    path.join(ROOT, 'client_secret.json'),
    path.join(process.env.USERPROFILE || '', 'Downloads'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      const stats = fs.statSync(dir);
      if (stats.isDirectory()) {
        const secretFiles = fs.readdirSync(dir).filter(f => f.startsWith('client_secret_') && f.endsWith('.json'));
        if (secretFiles.length > 0) {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, secretFiles[0]), 'utf8'));
          const creds = parsed.installed || parsed.web || {};
          CLIENT_ID = creds.client_id;
          CLIENT_SECRET = creds.client_secret;
          break;
        }
      }
    }
  }
}

const PORT = 8989;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: No OAuth credentials found. Set CHROME_CLIENT_ID and CHROME_CLIENT_SECRET or place client_secret.json in the project root.');
  process.exit(1);
}

const AUTH_URL = `https://accounts.google.com/o/oauth2/auth?` +
  new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: REDIRECT_URI,
    access_type: 'offline',
    prompt: 'consent',
  }).toString();

function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString();

    const req = https.request(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(data.error_description || data.error || body));
            }
          } catch (err) {
            reject(new Error(`Failed to parse token response: ${body}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  if (reqUrl.pathname !== '/') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const code = reqUrl.searchParams.get('code');
  const error = reqUrl.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font-family:sans-serif;padding:40px;background:#fff1f0;color:#cf1322">
      <h2>Authorization Denied</h2>
      <p>Error: ${error}</p>
      <p>You can close this window and try again.</p>
    </body></html>`);
    console.error(`\nAuthorization was cancelled or denied: ${error}`);
    server.close();
    process.exit(1);
    return;
  }

  if (!code) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font-family:sans-serif;padding:40px;">Waiting for Google authorization...</body></html>`);
    return;
  }

  try {
    console.log('\nReceived authorization code. Exchanging for refresh token...');
    const tokenData = await exchangeCode(code);

    const outPath = path.join(ROOT, '.env.webstore');
    const creds = {
      CHROME_CLIENT_ID: CLIENT_ID,
      CHROME_CLIENT_SECRET: CLIENT_SECRET,
      CHROME_REFRESH_TOKEN: tokenData.refresh_token,
      ACCESS_TOKEN: tokenData.access_token,
      SAVED_AT: new Date().toISOString(),
    };

    fs.writeFileSync(outPath, Object.entries(creds).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', 'utf8');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font-family:sans-serif;padding:40px;background:#f6ffed;color:#389e0d;text-align:center">
      <h2>Success! Chrome Web Store API Authorized</h2>
      <p style="color:#333">Your refresh token has been securely acquired and saved.</p>
      <p style="color:#666">You can close this browser tab and return to the assistant.</p>
    </body></html>`);

    console.log('\n======================================================');
    console.log('SUCCESS! Refresh Token Acquired.');
    console.log('======================================================');
    console.log(`Saved credentials to: ${outPath}`);
    console.log(`Refresh Token: ${tokenData.refresh_token ? tokenData.refresh_token.slice(0, 10) + '...' : '(none returned)'}`);
    console.log('======================================================\n');

    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 1000);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font-family:sans-serif;padding:40px;background:#fff1f0;color:#cf1322">
      <h2>Token Exchange Failed</h2>
      <p>${err.message}</p>
    </body></html>`);
    console.error(`\nToken exchange failed: ${err.message}`);
    setTimeout(() => {
      server.close();
      process.exit(1);
    }, 1000);
  }
});

server.listen(PORT, () => {
  console.log(`OAuth server listening at http://localhost:${PORT}`);
  console.log(`\nOpening your browser for authorization with hamidbloger1@gmail.com...`);
  console.log(`If it doesn't open automatically, visit this URL:\n\n${AUTH_URL}\n`);

  // Open browser in Windows
  exec(`start "" "${AUTH_URL}"`);
});
