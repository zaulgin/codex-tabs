'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTabs } = require('../src/tabs');

function api() {
  const opened = [];
  const extension = {
    packageJSON: { contributes: { customEditors: [{ viewType: 'chatgpt.conversationEditor' }] } },
    activate: async () => {},
  };
  class TabInputCustom {
    constructor(uri) { this.uri = uri; this.viewType = 'chatgpt.conversationEditor'; }
  }
  const vscode = {
    workspace: { isTrusted: true },
    extensions: { getExtension: (id) => id === 'openai.chatgpt' ? extension : undefined },
    Uri: { parse: (uri) => new URL(uri) },
    TabInputCustom,
    ViewColumn: { Active: -1 },
    window: { tabGroups: { all: [] } },
    commands: { executeCommand: async (...args) => { opened.push(args); } },
  };
  return { vscode, opened, extension };
}

test('new chat opens two distinct official editors, outside preview mode', async () => {
  const { vscode, opened } = api();
  const tabs = createTabs(vscode);
  await tabs.newChat();
  await tabs.newChat();
  assert.equal(opened.length, 2);
  assert.notEqual(opened[0][1].toString(), opened[1][1].toString());
  assert.equal(opened[0][0], 'vscode.openWith');
  assert.equal(opened[0][2], 'chatgpt.conversationEditor');
  assert.equal(opened[0][3].preview, false);
});

test('opening a known conversation targets its existing editor group', async () => {
  const { vscode, opened } = api();
  const uri = new URL('openai-codex://route/local/test-123?instance=existing');
  vscode.window.tabGroups.all = [{ viewColumn: 2, tabs: [{ input: new vscode.TabInputCustom(uri) }] }];
  await createTabs(vscode).openConversation('test-123');
  assert.equal(opened[0][1], uri);
  assert.equal(opened[0][3].viewColumn, 2);
});

test('untrusted workspace cannot activate Codex or open a chat', async () => {
  const { vscode, opened, extension } = api();
  vscode.workspace.isTrusted = false;
  let activated = false;
  extension.activate = async () => { activated = true; };
  await assert.rejects(createTabs(vscode).newChat(), /Trust/);
  assert.equal(activated, false);
  assert.equal(opened.length, 0);
});

test('unsupported official extension fails without invoking an arbitrary editor', async () => {
  const { vscode, opened, extension } = api();
  extension.packageJSON.contributes.customEditors = [];
  await assert.rejects(createTabs(vscode).newChat(), /compatible/);
  assert.equal(opened.length, 0);
});

test('invalid history ID is rejected before official activation', async () => {
  const { vscode, extension } = api();
  let activated = false;
  extension.activate = async () => { activated = true; };
  await assert.rejects(createTabs(vscode).openConversation('../elsewhere'), /Invalid conversation/);
  assert.equal(activated, false);
});
