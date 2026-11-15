'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { historyItems, showHistory } = require('../src/history-picker');

function pickerApi() {
  const handlers = {};
  const picker = {
    items: [], selectedItems: [], value: '',
    show() {}, hide() { handlers.hide?.(); }, dispose() {},
    onDidHide(fn) { handlers.hide = fn; return { dispose() {} }; },
    onDidAccept(fn) { handlers.accept = fn; return { dispose() {} }; },
    onDidChangeValue(fn) { handlers.change = fn; return { dispose() {} }; },
  };
  return { picker, handlers, vscode: { window: { createQuickPick: () => picker, showErrorMessage: () => {} } } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('history metadata is normalized, invalid IDs cannot become editor routes', () => {
  const items = historyItems([
    { id: 'chat-1', name: 'Title\n$(warning)', cwd: '/repo', updatedAt: 1700000000 },
    { id: 'chat-2', name: null, preview: 'Fallback', cwd: '/other' },
    { id: '../escape', name: 'Bad' }, null,
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].label, 'Title \\$(warning)');
  assert.equal(items[1].label, 'Fallback');
  assert.equal(items[0].id, 'chat-1');
});

test('server search results remain visible when the matching title suffix is truncated', () => {
  const [item] = historyItems([{ id: 'long-title', name: `${'a'.repeat(250)} needle` }]);
  assert.equal(item.label.includes('needle'), false);
  assert.equal(item.alwaysShow, true);
});

test('picker cancellation aborts startup and disposes even a late client', async () => {
  const { vscode, picker } = pickerApi();
  const connection = deferred();
  let signal;
  let disposed = 0;
  const done = showHistory(vscode, (s) => { signal = s; return connection.promise; });
  await tick();
  picker.hide();
  assert.equal(await done, null);
  assert.equal(signal.aborted, true);
  connection.resolve({ dispose() { disposed++; }, listThreads() { throw new Error('must not query'); } });
  await tick();
  assert.equal(disposed, 1);
});

test('selected conversation is returned and helper is disposed', async () => {
  const { vscode, picker, handlers } = pickerApi();
  let disposed = 0;
  const done = showHistory(vscode, async () => ({
    listThreads: async () => ({ data: [{ id: 'chat-1', name: 'First' }], nextCursor: null }),
    dispose() { disposed++; },
  }));
  await tick();
  picker.selectedItems = [picker.items[0]];
  handlers.accept();
  assert.equal(await done, 'chat-1');
  assert.equal(disposed, 1);
});

test('load more appends history and does not close the picker', async () => {
  const { vscode, picker, handlers } = pickerApi();
  const cursors = [];
  const done = showHistory(vscode, async () => ({
    listThreads: async ({ cursor }) => {
      cursors.push(cursor);
      return cursor ? { data: [{ id: 'chat-2', name: 'Second' }], nextCursor: null }
        : { data: [{ id: 'chat-1', name: 'First' }], nextCursor: 'next' };
    },
    dispose() {},
  }));
  await tick();
  picker.selectedItems = [picker.items.at(-1)];
  handlers.accept();
  await tick();
  assert.deepEqual(cursors, [null, 'next']);
  assert.deepEqual(picker.items.map((item) => item.id), ['chat-1', 'chat-2']);
  picker.hide();
  assert.equal(await done, null);
});

test('search results that arrive late cannot replace a newer query', async () => {
  const { vscode, picker, handlers } = pickerApi();
  const first = deferred();
  const done = showHistory(vscode, async () => ({
    listThreads: ({ searchTerm }) => searchTerm ? Promise.resolve({ data: [{ id: 'new', name: 'New' }], nextCursor: null }) : first.promise,
    dispose() {},
  }));
  await tick();
  picker.value = 'New';
  handlers.change('New');
  await new Promise((resolve) => setTimeout(resolve, 300));
  first.resolve({ data: [{ id: 'old', name: 'Old' }], nextCursor: null });
  await tick();
  assert.deepEqual(picker.items.map((item) => item.id), ['new']);
  picker.hide();
  await done;
});
