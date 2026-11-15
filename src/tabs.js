'use strict';

const { newChatUri, conversationUri, conversationIdFromUri } = require('./routes');

const EDITOR = 'chatgpt.conversationEditor';

class TabError extends Error {}

function createTabs(vscode) {
  async function ensureOfficial() {
    if (!vscode.workspace.isTrusted) throw new TabError('Trust this workspace before opening Codex.');
    const extension = vscode.extensions.getExtension('openai.chatgpt');
    if (!extension) throw new TabError('Install and enable the official Codex extension in this environment.');
    const editors = extension.packageJSON?.contributes?.customEditors;
    if (!Array.isArray(editors) || !editors.some((editor) => editor.viewType === EDITOR)) {
      throw new TabError('This version of Codex does not expose a compatible chat editor.');
    }
    await extension.activate();
    return extension;
  }

  async function open(uri, viewColumn = vscode.ViewColumn.Active) {
    await vscode.commands.executeCommand('vscode.openWith', uri, EDITOR, {
      viewColumn, preserveFocus: false, preview: false,
    });
  }

  return {
    ensureOfficial,
    async newChat() {
      await ensureOfficial();
      await open(vscode.Uri.parse(newChatUri()));
    },
    async openConversation(id) {
      const target = conversationUri(id);
      await ensureOfficial();
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputCustom && tab.input.viewType === EDITOR &&
              conversationIdFromUri(tab.input.uri.toString()) === id) {
            await open(tab.input.uri, group.viewColumn);
            return;
          }
        }
      }
      await open(vscode.Uri.parse(target));
    },
  };
}

module.exports = { createTabs, TabError };
