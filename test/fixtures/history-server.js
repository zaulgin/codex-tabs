'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const readline = require('node:readline');

const [scenario = 'normal', pidFile] = process.argv.slice(2);
if (pidFile) fs.writeFileSync(pidFile, String(process.pid));
const marker = 'synthetic-private-marker';
let initialized = false;
let pendingList;

function send(message) {
  const bytes = Buffer.from(`${JSON.stringify(message)}\n`);
  // Split inside a multibyte character to exercise framing across pipe chunks.
  const split = bytes.indexOf(Buffer.from('Ж')) + 1;
  if (scenario === 'normal' && split > 0) {
    process.stdout.write(bytes.subarray(0, split));
    setTimeout(() => process.stdout.write(bytes.subarray(split)), 5);
  } else {
    process.stdout.write(bytes);
  }
}

function respondToList(message) {
  send({ id: message.id, result: {
    data: [{ id: 'thread-one', name: 'Журнал', pid: process.pid,
      page: message.params.cursor ? 2 : 1,
      search: message.params.searchTerm ?? null }],
    nextCursor: message.params.cursor ? null : 'page-two',
  } });
}

if (['ignore-term', 'stdin-close'].includes(scenario)) setInterval(() => {}, 1000);
if (scenario === 'ignore-term') process.on('SIGTERM', () => {
  fs.writeFileSync(`${pidFile}.term`, 'received');
});
process.stderr.write(`${marker}\n`);
const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    assert.equal(message.params.clientInfo.name, 'codex_tabs');
    assert.match(message.params.clientInfo.version, /^\d+\.\d+\.\d+$/);
    if (scenario === 'startup-timeout') return;
    if (scenario === 'stderr-flood') {
      process.stderr.write(marker.repeat(65536), () => {
        send({ id: message.id, result: { userAgent: 'fixture' } });
      });
      return;
    }
    send({ id: message.id, result: { userAgent: 'fixture' } });
    return;
  }
  if (message.method === 'initialized') {
    initialized = true;
    if (scenario === 'stdin-close') {
      process.stdin.destroy();
      fs.closeSync(0);
      fs.writeFileSync(`${pidFile}.ready`, 'closed');
    }
    return;
  }
  if (message.id === 900 && !message.method) {
    assert.equal(message.error.code, -32601);
    assert.equal(message.result, undefined);
    respondToList(pendingList);
    return;
  }
  assert.equal(initialized, true);
  assert.equal(message.method, 'thread/list');
  const { cursor, searchTerm, useStateDbOnly, ...required } = message.params;
  assert.deepEqual(required, {
    sourceKinds: ['cli', 'vscode', 'appServer'], modelProviders: [],
    sortKey: 'updated_at', limit: 50,
  });
  if (useStateDbOnly !== undefined) assert.equal(useStateDbOnly, true);
  if (cursor !== undefined) assert.equal(cursor, 'page-two');
  if (searchTerm !== undefined) assert.equal(searchTerm, 'needle');
  // Scanning a large rollout directory can outlive the client's request timeout.
  if (scenario === 'indexed' && useStateDbOnly !== true) return;
  if (['timeout', 'ignore-term'].includes(scenario)) return;
  if (scenario === 'server-error') {
    send({ id: message.id, error: { code: -32000, message: marker, data: marker } });
  } else if (scenario === 'malformed') {
    process.stdout.write(`{${marker}\n`);
  } else if (scenario === 'oversize') {
    process.stdout.write('x'.repeat(8 * 1024 * 1024 + 1));
  } else if (scenario === 'invalid-data') {
    send({ id: message.id, result: { data: {}, nextCursor: null } });
  } else if (scenario === 'invalid-cursor') {
    send({ id: message.id, result: { data: [], nextCursor: 123 } });
  } else if (scenario === 'missing-cursor') {
    send({ id: message.id, result: { data: [] } });
  } else if (scenario === 'exit') {
    process.exit(17);
  } else if (scenario === 'action-request') {
    pendingList = message;
    send({ id: 900, method: 'item/commandExecution/requestApproval', params: { command: marker } });
  } else if (scenario === 'stale') {
    send({ id: 9999, result: { data: [{ id: 'wrong' }], nextCursor: null } });
    send({ method: 'server/notification', params: {} });
    respondToList(message);
  } else {
    respondToList(message);
  }
});

input.on('close', () => {
  if (!['ignore-term', 'stdin-close'].includes(scenario)) process.exit(0);
});
