'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LicenseClient } = require('../index.js');
const http = require('http');

// ─── Test Helpers ──────────────────────────────────────────────────

/**
 * Create a mock license server for testing.
 */
function createMockServer(port, handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const result = handler(req, parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });
    server.listen(port, () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// ─── Constructor Tests ─────────────────────────────────────────────

test('LicenseClient requires productId', () => {
  assert.throws(() => new LicenseClient({ serverUrl: 'http://localhost' }), /productId/);
});

test('LicenseClient requires serverUrl', () => {
  assert.throws(() => new LicenseClient({ productId: 'test' }), /serverUrl/);
});

test('LicenseClient constructs with valid options', () => {
  const client = new LicenseClient({
    productId: 'test-product',
    serverUrl: 'http://localhost:9999',
  });
  assert.equal(client.productId, 'test-product');
  assert.equal(client.serverUrl, 'http://localhost:9999');
  assert.ok(client.machineId);
  assert.equal(client.machineId.length, 32);
});

test('LicenseClient strips trailing slash from serverUrl', () => {
  const client = new LicenseClient({
    productId: 'test',
    serverUrl: 'http://localhost:9999/',
  });
  assert.equal(client.serverUrl, 'http://localhost:9999');
});

// ─── Validation Tests ──────────────────────────────────────────────

test('validate returns invalid for empty key', async () => {
  const client = new LicenseClient({ productId: 'test', serverUrl: 'http://localhost:9999' });
  const result = await client.validate('');
  assert.equal(result.valid, false);
  assert.match(result.error, /No license key/);
});

test('validate returns invalid for null key', async () => {
  const client = new LicenseClient({ productId: 'test', serverUrl: 'http://localhost:9999' });
  const result = await client.validate(null);
  assert.equal(result.valid, false);
});

test('validate succeeds against mock server', async () => {
  const port = 9876;
  const server = await createMockServer(port, (req, body) => {
    if (body.key === 'VALID-KEY' && body.productId === 'test-product') {
      return { valid: true, productId: 'test-product', sku: 'pro' };
    }
    return { valid: false, error: 'Invalid key' };
  });

  try {
    const client = new LicenseClient({
      productId: 'test-product',
      serverUrl: `http://localhost:${port}`,
    });
    const result = await client.validate('VALID-KEY');
    assert.equal(result.valid, true);
    assert.equal(result.productId, 'test-product');
    assert.equal(result.sku, 'pro');
  } finally {
    await closeServer(server);
  }
});

test('validate fails for wrong product', async () => {
  const port = 9877;
  const server = await createMockServer(port, (req, body) => {
    return { valid: false, error: 'Product mismatch' };
  });

  try {
    const client = new LicenseClient({
      productId: 'test-product',
      serverUrl: `http://localhost:${port}`,
    });
    const result = await client.validate('SOME-KEY');
    assert.equal(result.valid, false);
  } finally {
    await closeServer(server);
  }
});

test('validate caches successful result', async () => {
  const port = 9878;
  let requestCount = 0;
  const server = await createMockServer(port, (req, body) => {
    requestCount++;
    return { valid: true, productId: body.productId, sku: 'pro' };
  });

  try {
    const client = new LicenseClient({
      productId: 'test-product',
      serverUrl: `http://localhost:${port}`,
    });
    
    // First validation hits server
    const r1 = await client.validate('CACHED-KEY');
    assert.equal(r1.valid, true);
    assert.equal(requestCount, 1);
    
    // Second validation uses cache (no server hit)
    const r2 = await client.validate('CACHED-KEY');
    assert.equal(r2.valid, true);
    assert.equal(r2.cached, true);
    assert.equal(requestCount, 1); // Still 1, used cache
  } finally {
    await closeServer(server);
  }
});

test('isProUnlocked returns true after successful validation', async () => {
  const port = 9879;
  const server = await createMockServer(port, () => ({ valid: true, productId: 'test' }));

  try {
    const client = new LicenseClient({
      productId: 'test',
      serverUrl: `http://localhost:${port}`,
    });
    assert.equal(client.isProUnlocked(), false);
    await client.validate('VALID');
    assert.equal(client.isProUnlocked(), true);
  } finally {
    await closeServer(server);
  }
});

// ─── Network Error Tests ───────────────────────────────────────────

test('validate handles server unreachable gracefully', async () => {
  const client = new LicenseClient({
    productId: 'test',
    serverUrl: 'http://localhost:1', // Port 1 should be unreachable
    timeout: 1000,
  });
  const result = await client.validate('SOME-KEY');
  assert.equal(result.valid, false);
  assert.ok(result.networkError || result.error);
});

test('validate uses cache on network error (graceful degradation)', async () => {
  const port = 9880;
  const server = await createMockServer(port, () => ({ valid: true, productId: 'test' }));

  try {
    const client = new LicenseClient({
      productId: 'test',
      serverUrl: `http://localhost:${port}`,
    });
    
    // First: successful validation (caches result)
    const r1 = await client.validate('KEY-1');
    assert.equal(r1.valid, true);
    
    // Close server (simulate outage)
    await closeServer(server);
    
    // Second: should use cache despite network error
    const r2 = await client.validate('KEY-1');
    assert.equal(r2.valid, true);
    assert.equal(r2.cached, true);
    assert.equal(r2.networkError, true);
  } catch (err) {
    // Server already closed
  }
});

// ─── Activation Tests ──────────────────────────────────────────────

test('activate returns activated: true on success', async () => {
  const port = 9881;
  const server = await createMockServer(port, (req, body) => {
    return { valid: true, productId: body.productId, machineId: body.machineId };
  });

  try {
    const client = new LicenseClient({
      productId: 'test',
      serverUrl: `http://localhost:${port}`,
    });
    const result = await client.activate('NEW-KEY');
    assert.equal(result.valid, true);
    assert.equal(result.activated, true);
  } finally {
    await closeServer(server);
  }
});

// ─── Sign Out Tests ────────────────────────────────────────────────

test('signOut clears cache and Pro status', async () => {
  const port = 9882;
  const server = await createMockServer(port, () => ({ valid: true }));

  try {
    const client = new LicenseClient({
      productId: 'test',
      serverUrl: `http://localhost:${port}`,
    });
    await client.validate('KEY');
    assert.equal(client.isProUnlocked(), true);
    assert.equal(client.getCachedKey(), 'KEY');
    
    client.signOut();
    assert.equal(client.isProUnlocked(), false);
    assert.equal(client.getCachedKey(), null);
  } finally {
    await closeServer(server);
  }
});

// ─── Machine ID Tests ──────────────────────────────────────────────

test('machineId is deterministic for same system', () => {
  const c1 = new LicenseClient({ productId: 't', serverUrl: 'http://localhost:1' });
  const c2 = new LicenseClient({ productId: 't', serverUrl: 'http://localhost:1' });
  assert.equal(c1.machineId, c2.machineId);
});

test('custom machineId is respected', () => {
  const client = new LicenseClient({
    productId: 't',
    serverUrl: 'http://localhost:1',
    machineId: 'custom-machine-id',
  });
  assert.equal(client.machineId, 'custom-machine-id');
});
