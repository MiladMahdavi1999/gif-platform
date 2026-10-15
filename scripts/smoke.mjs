import assert from 'node:assert/strict';

const base = 'http://localhost:8080';
const live = await fetch(`${base}/api/v1/health/live`);
assert.equal(live.status, 200);
assert.deepEqual(await live.json(), { status: 'ok' });
const ready = await fetch(`${base}/api/v1/health/ready`);
assert.equal(ready.status, 200);
assert.deepEqual(await ready.json(), {
  status: 'ready',
  checks: { database: 'up', storage: 'up' },
});
const home = await fetch(base);
assert.equal(home.status, 200);
assert.match(await home.text(), /GIF Platform/);
console.log('PASS: single-origin home, liveness and dependency readiness');
