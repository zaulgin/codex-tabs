'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newChatUri, conversationUri, conversationIdFromUri } = require('../src/routes');

test('new chat requests cannot resolve to the same editor resource', () => {
  const uris = Array.from({ length: 100 }, () => newChatUri());
  assert.equal(new Set(uris).size, 100);
  const first = new URL(uris[0]);
  assert.equal(first.protocol, 'openai-codex:');
  assert.equal(first.hostname, 'route');
  assert.equal(first.pathname, '/extension/panel/new');
  assert.match(first.searchParams.get('instance'), /^[0-9a-f-]{36}$/);
});

test('existing conversation has a stable official route', () => {
  assert.equal(conversationUri('019abc-def_123'), 'openai-codex://route/local/019abc-def_123');
  assert.equal(conversationUri('019abc-def_123'), conversationUri('019abc-def_123'));
});

test('conversation identifiers cannot inject paths, query or commands', () => {
  for (const id of ['', '../other', 'a/b', 'a?x=1', 'a#x', 'a%2fb', 'a\n', 'a b', null, {}, 'a'.repeat(257)]) {
    assert.throws(() => conversationUri(id), /Invalid conversation ID/);
  }
});

test('focus lookup recognizes only official local conversation resources', () => {
  assert.equal(conversationIdFromUri('openai-codex://route/local/abc-123'), 'abc-123');
  assert.equal(conversationIdFromUri('openai-codex://route/local/abc-123?instance=x'), 'abc-123');
  for (const uri of ['file:///local/abc', 'openai-codex://wrong/local/abc', 'openai-codex://route/local/abc/def', 'openai-codex://route/extension/panel/new', 'not a uri']) {
    assert.equal(conversationIdFromUri(uri), null);
  }
});
