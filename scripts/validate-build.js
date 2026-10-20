#!/usr/bin/env node
/**
 * validate-build.js — Node validation gate for the PinVault release build.
 *
 * Checks, in order:
 *  1. manifest.json parses and satisfies the MV3 contract
 *  2. every required loadable file exists
 *  3. every JavaScript file in the loadable set passes `node --check`
 *  4. the automated test suite runs and passes (node tests/run-tests.js)
 *
 * Exits 0 on success, 1 on failure. No dependencies beyond Node itself.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const REQUIRED_FILES = [
  'manifest.json',
  'background/service-worker.js',
  'content/content.js',
  'content/content.css',
  'popup/popup.html',
  'popup/popup.js',
  'popup/popup.css',
  'dashboard/dashboard.html',
  'dashboard/dashboard.js',
  'dashboard/dashboard.css',
  'lib/url-utils.js',
  'lib/pin-extractor.js',
  'lib/filename-utils.js',
  'lib/duplicate-utils.js',
  'lib/queue.js',
  'lib/storage.js',
  'lib/messaging.js',
  'lib/export-utils.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'icons/icon.svg',
];

const EXACT_PERMISSIONS = ['storage', 'downloads', 'activeTab'];
const EXACT_HOST_PERMISSIONS = [
  '*://*.pinterest.com/*',
  '*://*.pinimg.com/*',
  'https://pin.it/*',
];

let failures = 0;

function fail(msg) {
  failures += 1;
  console.error(`  FAIL  ${msg}`);
}

function ok(msg) {
  console.log(`  ok    ${msg}`);
}

console.log('[1/4] Validating manifest.json');
let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  ok('manifest.json parses as JSON');
} catch (err) {
  fail(`manifest.json parse error: ${err.message}`);
}

if (manifest) {
  const checks = [
    ['manifest_version is 3', manifest.manifest_version === 3],
    ['name is PinVault product name', manifest.name === 'PinVault — Pinterest Image & Video Downloader'],
    ['version is 1.0.0', manifest.version === '1.0.0'],
    ['minimum_chrome_version >= 116', String(manifest.minimum_chrome_version || '').replace(/^Chrome\s*/i, '') === '116'],
    ['background service worker is a module', manifest.background && manifest.background.service_worker === 'background/service-worker.js' && manifest.background.type === 'module'],
    ['content script targets Pinterest domains only', Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 1 && (manifest.content_scripts[0].matches || []).every((m) => m.includes('pinterest')) && (manifest.content_scripts[0].js || []).includes('content/content.js')],
    ['permissions are exactly storage/downloads/activeTab', JSON.stringify((manifest.permissions || []).slice().sort()) === JSON.stringify(EXACT_PERMISSIONS.slice().sort())],
    ['host_permissions are scoped to Pinterest hosts only', JSON.stringify((manifest.host_permissions || []).slice().sort()) === JSON.stringify(EXACT_HOST_PERMISSIONS.slice().sort())],
    ['popup configured', manifest.action && manifest.action.default_popup === 'popup/popup.html'],
    ['options/dashboard configured', manifest.options_page === 'dashboard/dashboard.html'],
    ['icons declared', manifest.icons && manifest.icons['16'] === 'icons/icon16.png' && manifest.icons['128'] === 'icons/icon128.png'],
  ];
  for (const [label, pass] of checks) {
    if (pass) ok(label);
    else fail(label);
  }
}

console.log('[2/4] Verifying required loadable files');
for (const rel of REQUIRED_FILES) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) ok(`exists ${rel}`);
  else fail(`missing ${rel}`);
}

console.log('[3/4] Syntax-checking JavaScript files');
function collectJs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJs(abs));
    else if (entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}
const jsFiles = [
  path.join(ROOT, 'background', 'service-worker.js'),
  path.join(ROOT, 'content', 'content.js'),
  path.join(ROOT, 'popup', 'popup.js'),
  path.join(ROOT, 'dashboard', 'dashboard.js'),
  ...collectJs(path.join(ROOT, 'lib')),
];
for (const abs of jsFiles) {
  const res = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
  if (res.status === 0) ok(`syntax ok ${path.relative(ROOT, abs)}`);
  else {
    fail(`syntax error ${path.relative(ROOT, abs)}\n${res.stderr || res.stdout}`);
  }
}

console.log('[4/4] Running automated test suite');
const testRes = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'run-tests.js')], {
  encoding: 'utf8',
  cwd: ROOT,
  timeout: 120000,
});
process.stdout.write(testRes.stdout || '');
if (testRes.stderr) process.stderr.write(testRes.stderr);
if (testRes.status !== 0) {
  fail(`test suite exited with code ${testRes.status}`);
} else {
  const totalLine = (testRes.stdout || '').split('\n').filter((l) => l.startsWith('TOTAL:')).pop() || '';
  const m = totalLine.match(/TOTAL:\s*(\d+)\s+passed,\s*(\d+)\s+failed/i);
  if (m && Number(m[2]) === 0) ok(`tests passed: ${m[1]} passed, ${m[2]} failed`);
  else fail(`test suite result unexpected: ${totalLine || 'no TOTAL line'}`);
}

if (failures > 0) {
  console.error(`\nValidation FAILED with ${failures} problem(s).`);
  process.exit(1);
}
console.log('\nValidation PASSED. The extension is ready to package.');
process.exit(0);
