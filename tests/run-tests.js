/**
 * Minimal zero-dependency test harness.
 * Usage: node tests/run-tests.js [filter]
 * Discovers tests/*.test.js files and runs each exported test.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RESULTS = { pass: 0, fail: 0, errors: [] };

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}
assert.strictEqual = (a, b, msg) => {
  if (a !== b) throw new Error((msg || 'strictEqual failed') + `\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);
};
assert.deepEqual = (a, b, msg) => {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error((msg || 'deepEqual failed') + `\n  expected: ${jb}\n  actual:   ${ja}`);
};
assert.notStrictEqual = (a, b, msg) => {
  if (a === b) throw new Error((msg || 'notStrictEqual failed') + `\n  value: ${JSON.stringify(a)}`);
};
assert.ok = (v, msg) => { if (!v) throw new Error(msg || 'ok failed'); };
assert.throws = (fn, msg) => {
  let threw = false;
  try { fn(); } catch (_e) { threw = true; }
  if (!threw) throw new Error(msg || 'expected function to throw');
};

global.assert = assert;

async function runFile(file) {
  const mod = require(file);
  const tests = Object.entries(mod);
  for (const [name, fn] of tests) {
    if (typeof fn !== 'function') continue;
    const label = `${path.basename(file)} :: ${name}`;
    try {
      await fn();
      RESULTS.pass++;
      console.log(`  PASS  ${label}`);
    } catch (err) {
      RESULTS.fail++;
      RESULTS.errors.push({ label, err });
      console.log(`  FAIL  ${label}`);
      console.log(`        ${(err && err.stack || err).toString().split('\n').slice(0, 4).join('\n        ')}`);
    }
  }
}

async function main() {
  const filter = process.argv[2] || '';
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js'));
  for (const f of files) {
    if (filter && !f.includes(filter)) continue;
    console.log(`\n[suite] ${f}`);
    await runFile(path.join(dir, f));
  }
  console.log(`\nTOTAL: ${RESULTS.pass} passed, ${RESULTS.fail} failed`);
  if (RESULTS.fail > 0) {
    console.log('\nFailures:');
    for (const e of RESULTS.errors) console.log(`  - ${e.label}: ${e.err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Harness error:', err);
  process.exit(2);
});
