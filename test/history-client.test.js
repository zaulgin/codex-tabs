'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { HistoryClient, historyErrorMessage } = require('../src/history-client');

const fixture = path.join(__dirname, 'fixtures', 'history-server.js');

async function fixtureOptions(t, scenario = 'normal', timeoutMs = 2000) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-tabs-history-'));
  const pidFile = path.join(directory, 'helper.pid');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return {
    executable: process.execPath, args: [fixture, scenario, pidFile],
    cwd: directory, env: {}, timeoutMs, pidFile,
  };
}

async function assertStopped(options) {
  let pid;
  try { pid = Number(await fs.readFile(options.pidFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

async function waitForFile(filename) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try { await fs.access(filename); return; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(10);
  }
  assert.fail('Synthetic helper did not reach the expected state');
}

function safeError(code) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(`${error.message}${error.stack}`.includes('synthetic-private-marker'), false);
    return true;
  };
}

test('shows a useful history failure without exposing private upstream details', () => {
  const message = historyErrorMessage({ code: 'HISTORY_TIMEOUT', message: 'synthetic-private-marker' });
  assert.match(message, /вовремя/);
  assert.equal(message.includes('synthetic-private-marker'), false);
  assert.equal(historyErrorMessage({ code: 'UNKNOWN', message: 'synthetic-private-marker' }), undefined);
  assert.equal(historyErrorMessage({ code: '__proto__' }), undefined);
  assert.equal(historyErrorMessage(null), undefined);
});

test('initializes the helper and returns chunked UTF-8 history pages with search', async (t) => {
  const options = await fixtureOptions(t);
  const client = await HistoryClient.connect(options);
  t.after(() => client.dispose());
  const first = await client.listThreads({});
  assert.equal(first.data[0].name, 'Журнал');
  assert.equal(first.data[0].page, 1);
  assert.equal(first.nextCursor, 'page-two');
  const second = await client.listThreads({ cursor: first.nextCursor, searchTerm: 'needle' });
  assert.equal(second.data[0].page, 2);
  assert.equal(second.data[0].search, 'needle');
  assert.equal(second.nextCursor, null);
  await client.dispose();
  await assertStopped(options);
});

test('rejects server action requests instead of granting approval', async (t) => {
  const options = await fixtureOptions(t, 'action-request');
  const client = await HistoryClient.connect(options);
  t.after(() => client.dispose());
  assert.equal((await client.listThreads({})).data[0].id, 'thread-one');
});

test('loads indexed history without waiting for rollout metadata repair', async (t) => {
  const options = await fixtureOptions(t, 'indexed', 500);
  const client = await HistoryClient.connect(options);
  t.after(() => client.dispose());
  const first = await client.listThreads();
  assert.equal(first.data[0].id, 'thread-one');
  const second = await client.listThreads({ cursor: first.nextCursor, searchTerm: 'needle' });
  assert.equal(second.data[0].page, 2);
  assert.equal(second.data[0].search, 'needle');
});

test('ignores stale responses and notifications', async (t) => {
  const options = await fixtureOptions(t, 'stale');
  const client = await HistoryClient.connect(options);
  t.after(() => client.dispose());
  assert.equal((await client.listThreads({})).data[0].id, 'thread-one');
});

test('normalizes an omitted terminal cursor to null', async (t) => {
  const options = await fixtureOptions(t, 'missing-cursor');
  const client = await HistoryClient.connect(options);
  t.after(() => client.dispose());
  assert.deepEqual(await client.listThreads({}), { data: [], nextCursor: null });
});

test('drains stderr so a full private diagnostics pipe cannot block initialization', async (t) => {
  const options = await fixtureOptions(t, 'stderr-flood');
  const client = await HistoryClient.connect(options);
  t.after(() => client.dispose());
  assert.equal((await client.listThreads({})).data[0].id, 'thread-one');
});

test('handles a closed input pipe without an unhandled write error', async (t) => {
  const options = await fixtureOptions(t, 'stdin-close');
  const client = await HistoryClient.connect(options);
  t.after(() => client.dispose());
  await waitForFile(`${options.pidFile}.ready`);
  await assert.rejects(client.listThreads({}), safeError('HISTORY_IO_ERROR'));
  await assertStopped(options);
});

for (const [scenario, code] of [
  ['server-error', 'HISTORY_SERVER_ERROR'],
  ['malformed', 'HISTORY_PROTOCOL_ERROR'],
  ['oversize', 'HISTORY_PROTOCOL_ERROR'],
  ['invalid-data', 'HISTORY_PROTOCOL_ERROR'],
  ['invalid-cursor', 'HISTORY_PROTOCOL_ERROR'],
  ['exit', 'HISTORY_PROCESS_EXITED'],
]) {
  test(`${scenario} becomes a safe error and closes the helper`, async (t) => {
    const options = await fixtureOptions(t, scenario);
    const client = await HistoryClient.connect(options);
    t.after(() => client.dispose());
    await assert.rejects(client.listThreads({}), safeError(code));
    await assertStopped(options);
  });
}

test('times out a pending history request and closes the helper', async (t) => {
  const options = await fixtureOptions(t, 'timeout', 300);
  const client = await HistoryClient.connect(options);
  t.after(() => client.dispose());
  await assert.rejects(client.listThreads({}), safeError('HISTORY_TIMEOUT'));
  await assertStopped(options);
});

test('cancels a pending request and closes the helper', async (t) => {
  const options = await fixtureOptions(t, 'timeout');
  const client = await HistoryClient.connect(options);
  t.after(() => client.dispose());
  const controller = new AbortController();
  const result = client.listThreads({}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, safeError('HISTORY_CANCELLED'));
  await assertStopped(options);
});

test('cancels initialization and closes its process before rejecting', async (t) => {
  const options = await fixtureOptions(t, 'startup-timeout');
  const controller = new AbortController();
  const result = HistoryClient.connect({ ...options, signal: controller.signal });
  await waitForFile(options.pidFile);
  controller.abort();
  await assert.rejects(result, safeError('HISTORY_CANCELLED'));
  await assertStopped(options);
});

test('times out initialization and closes its process', async (t) => {
  const options = await fixtureOptions(t, 'startup-timeout', 300);
  await assert.rejects(HistoryClient.connect(options), safeError('HISTORY_TIMEOUT'));
  await assertStopped(options);
});

test('dispose rejects a pending call and escalates a helper that ignores SIGTERM', async (t) => {
  const options = await fixtureOptions(t, 'ignore-term');
  const client = await HistoryClient.connect(options);
  t.after(() => client.dispose());
  const result = client.listThreads({});
  const rejected = assert.rejects(result, safeError('HISTORY_CLOSED'));
  await client.dispose();
  await rejected;
  await fs.access(`${options.pidFile}.term`);
  await assertStopped(options);
  await client.dispose();
  await assert.rejects(client.listThreads({}), safeError('HISTORY_CLOSED'));
});

test('returns a safe actionable launch error for a missing executable', async (t) => {
  const options = await fixtureOptions(t);
  await assert.rejects(HistoryClient.connect({ ...options, executable: path.join(options.cwd, 'absent') }),
    safeError('HISTORY_START_FAILED'));
});
