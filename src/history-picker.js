'use strict';

const { conversationUri } = require('./routes');

function text(value, fallback = '') {
  return typeof value === 'string'
    ? value.replace(/[\r\n\t]/g, ' ').replace(/\$\(/g, '\\$(').slice(0, 240)
    : fallback;
}

function historyItems(records) {
  const items = [];
  for (const thread of records) {
    try { conversationUri(thread?.id); } catch { continue; }
    const date = Number.isFinite(thread.updatedAt) ? new Date(thread.updatedAt * 1000) : null;
    items.push({
      id: thread.id,
      label: text(thread.name) || text(thread.preview) || thread.id,
      // Codex filters full titles; VS Code must not re-filter truncated labels.
      alwaysShow: true,
      description: text(thread.cwd),
      detail: date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : undefined,
    });
  }
  return items;
}

function showHistory(vscode, connect, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const picker = vscode.window.createQuickPick();
    const abort = new AbortController();
    const subscriptions = [];
    let client;
    let closed = false;
    let timer;
    let generation = 0;
    let cursor = null;
    let rows = [];
    picker.title = 'Codex Tabs — History';
    picker.placeholder = 'Search conversation titles';
    picker.matchOnDescription = true;
    picker.busy = true;

    function finish(id = null, error) {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      abort.abort();
      client?.dispose();
      signal?.removeEventListener('abort', cancel);
      subscriptions.forEach((subscription) => subscription.dispose());
      picker.hide();
      picker.dispose();
      if (error) reject(error); else resolve(id);
    }

    const cancel = () => finish();

    async function load(append, requestGeneration) {
      if (!client || closed) return;
      const searchTerm = picker.value.trim() || null;
      picker.busy = true;
      try {
        const page = await client.listThreads({ cursor: append ? cursor : null, searchTerm });
        if (closed || requestGeneration !== generation) return;
        rows = [...new Map([...(append ? rows : []), ...historyItems(page.data)].map((item) => [item.id, item])).values()];
        cursor = page.nextCursor;
        picker.items = cursor ? [...rows, { label: 'Load more conversations…', loadMore: true, alwaysShow: true }] : rows;
        picker.placeholder = rows.length ? 'Search conversation titles' : 'No conversations found';
      } catch (error) {
        if (!closed && requestGeneration === generation) finish(null, error);
      } finally {
        if (!closed && requestGeneration === generation) picker.busy = false;
      }
    }

    subscriptions.push(picker.onDidHide(cancel));
    subscriptions.push(picker.onDidAccept(() => {
      const item = picker.selectedItems[0];
      if (picker.busy || !item) return;
      if (item.loadMore) void load(true, ++generation);
      else if (item.id) finish(item.id);
    }));
    subscriptions.push(picker.onDidChangeValue(() => {
      clearTimeout(timer);
      const current = ++generation;
      cursor = null;
      rows = [];
      picker.items = [];
      picker.busy = true;
      timer = setTimeout(() => void load(false, current), 250);
    }));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { finish(); return; }
    picker.show();
    // Starting now ensures hiding the picker can cancel even the handshake.
    Promise.resolve().then(() => connect(abort.signal)).then((connected) => {
      if (closed) { connected.dispose(); return; }
      client = connected;
      clearTimeout(timer);
      void load(false, ++generation);
    }, (error) => { if (!closed) finish(null, error); });
  });
}

module.exports = { historyItems, showHistory };
