'use strict';

const vscode = require('vscode');
const { createTabs, TabError } = require('./tabs');
const { conversationUri } = require('./routes');
const { HistoryClient, historyErrorMessage } = require('./history-client');
const { showHistory } = require('./history-picker');
const { historyOptions } = require('./runtime');

function activate(context) {
  const tabs = createTabs(vscode);
  const lifetime = new AbortController();
  let historyTask;
  context.subscriptions.push({ dispose: () => lifetime.abort() });

  function command(name, action, failure) {
    context.subscriptions.push(vscode.commands.registerCommand(name, async () => {
      try { await action(); } catch (error) {
        // Never display upstream stderr/errors: they may contain private configuration.
        await vscode.window.showErrorMessage(error instanceof TabError ? error.message : historyErrorMessage(error) || failure);
      }
    }));
  }

  command('codexTabs.newChat', () => tabs.newChat(),
    'Codex could not open a new tab. Check that the official extension is enabled and compatible.');

  command('codexTabs.openChatById', async () => {
    const id = await vscode.window.showInputBox({
      title: 'Codex Tabs — Open Chat',
      prompt: 'Conversation ID from Codex /status',
      validateInput(value) {
        try { conversationUri(value.trim()); return null; } catch { return 'Enter a valid conversation ID.'; }
      },
    });
    if (id !== undefined) await tabs.openConversation(id.trim());
  }, 'Codex could not open this conversation. Check its ID and the official extension.');

  command('codexTabs.openHistory', async () => {
    if (historyTask) return historyTask;
    historyTask = (async () => {
      const extension = await tabs.ensureOfficial();
      const active = vscode.window.activeTextEditor?.document.uri;
      const folder = (active && vscode.workspace.getWorkspaceFolder(active)) || vscode.workspace.workspaceFolders?.[0];
      const options = historyOptions({
        extensionPath: extension.extensionPath,
        cliPath: vscode.workspace.getConfiguration('codexTabs').get('cliPath'),
        officialCliPath: vscode.workspace.getConfiguration('chatgpt').get('cliExecutable'),
        cwd: folder?.uri.fsPath,
      });
      const id = await showHistory(vscode, (signal) => HistoryClient.connect({ ...options, signal }), { signal: lifetime.signal });
      if (id && !lifetime.signal.aborted) await tabs.openConversation(id);
    })();
    try { await historyTask; } finally { historyTask = undefined; }
  }, 'Could not load Codex history. Check codexTabs.cliPath and the Codex environment on this host, then try again.');
}

module.exports = { activate };
