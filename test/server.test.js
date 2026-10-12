import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../scripts/serve.mjs';

test('server serves only public frontend assets', async (t) => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const homepage = await fetch(origin);
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /练序/);
  assert.match((await fetch(`${origin}/core.js`)).headers.get('content-type'), /javascript/);
  for (const path of ['/package.json', '/.env', '/.git/config', '/..%2fREADME.md'])
    assert.equal((await fetch(origin + path)).status, 404);
  assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
});
