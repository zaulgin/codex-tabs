'use strict';

const { randomUUID } = require('node:crypto');

function validId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(id);
}

function newChatUri() {
  // The official command reuses one URI. A new resource is needed for each tab.
  return `openai-codex://route/extension/panel/new?instance=${randomUUID()}`;
}

function conversationUri(id) {
  if (!validId(id)) throw new Error('Invalid conversation ID');
  return `openai-codex://route/local/${id}`;
}

function conversationIdFromUri(value) {
  try {
    const uri = new URL(value);
    if (uri.protocol !== 'openai-codex:' || uri.host !== 'route' || uri.username || uri.password) return null;
    const match = /^\/local\/([^/]+)$/.exec(uri.pathname);
    return match && validId(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

module.exports = { newChatUri, conversationUri, conversationIdFromUri };
