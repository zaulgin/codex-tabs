'use strict';

const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MESSAGES = {
  HISTORY_START_FAILED: 'Не удалось запустить Codex. Проверьте путь к CLI в настройках.',
  HISTORY_PROCESS_EXITED: 'Codex завершился до ответа. Повторите открытие истории.',
  HISTORY_IO_ERROR: 'Связь с Codex прервалась. Повторите открытие истории.',
  HISTORY_PROTOCOL_ERROR: 'Codex вернул некорректные данные. Обновите CLI и повторите открытие истории.',
  HISTORY_SERVER_ERROR: 'Codex не смог загрузить историю. Проверьте CLI и повторите попытку.',
  HISTORY_TIMEOUT: 'Codex не ответил вовремя. Повторите открытие истории.',
  HISTORY_CANCELLED: 'Загрузка истории отменена.',
  HISTORY_CLOSED: 'Загрузка истории завершена. Откройте историю повторно.',
};

function historyError(code) {
  return Object.assign(new Error(MESSAGES[code]), { code });
}

class HistoryClient {
  #child;
  #timeoutMs;
  #pending = new Map();
  #nextId = 1;
  #closed = false;
  #closePromise;
  #disposePromise;
  #decoder = new StringDecoder('utf8');
  #line = '';
  #lineBytes = 0;

  static async connect({ executable, args = [], cwd, env, timeoutMs = 15000, signal }) {
    if (signal?.aborted) throw historyError('HISTORY_CANCELLED');
    let client;
    try {
      client = new HistoryClient({ executable, args, cwd, env, timeoutMs });
    } catch {
      throw historyError('HISTORY_START_FAILED');
    }
    try {
      await client.#request('initialize', {
        clientInfo: { name: 'codex_tabs', version: '0.1.0' },
      }, signal);
      if (signal?.aborted) throw historyError('HISTORY_CANCELLED');
      await client.#write({ method: 'initialized' });
      if (client.#closed) throw historyError('HISTORY_PROCESS_EXITED');
      return client;
    } catch (error) {
      await client.dispose();
      throw error;
    }
  }

  constructor({ executable, args, cwd, env, timeoutMs }) {
    this.#timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;
    this.#child = spawn(executable, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.#closePromise = new Promise((resolve) => {
      this.#child.once('close', () => {
        resolve();
        if (!this.#closed) this.#fail(historyError('HISTORY_PROCESS_EXITED'));
      });
    });
    this.#child.on('error', () => this.#fail(historyError('HISTORY_START_FAILED')));
    this.#child.once('exit', () => {
      if (!this.#closed) this.#fail(historyError('HISTORY_PROCESS_EXITED'));
    });
    this.#child.stdout.on('data', (chunk) => this.#receive(chunk));
    this.#child.stdout.on('error', () => this.#fail(historyError('HISTORY_IO_ERROR')));
    this.#child.stdin.on('error', () => this.#fail(historyError('HISTORY_IO_ERROR')));
    // Stderr can contain private chat or authentication data; only drain it.
    this.#child.stderr.on('error', () => this.#fail(historyError('HISTORY_IO_ERROR')));
    this.#child.stderr.resume();
  }

  async listThreads({ cursor = null, searchTerm = null } = {}, { signal } = {}) {
    if ((cursor !== null && typeof cursor !== 'string') ||
        (searchTerm !== null && typeof searchTerm !== 'string')) {
      throw historyError('HISTORY_PROTOCOL_ERROR');
    }
    try {
      const result = await this.#request('thread/list', {
        sourceKinds: ['cli', 'vscode', 'appServer'],
        modelProviders: [], sortKey: 'updated_at', limit: 50,
        ...(cursor === null ? {} : { cursor }),
        ...(searchTerm === null ? {} : { searchTerm }),
      }, signal);
      if (!result || !Array.isArray(result.data) ||
          (result.nextCursor != null && typeof result.nextCursor !== 'string')) {
        throw historyError('HISTORY_PROTOCOL_ERROR');
      }
      return { data: result.data, nextCursor: result.nextCursor ?? null };
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  dispose() {
    if (this.#disposePromise) return this.#disposePromise;
    this.#closed = true;
    this.#rejectPending(historyError('HISTORY_CLOSED'));
    this.#line = '';
    this.#lineBytes = 0;
    this.#decoder = new StringDecoder('utf8');
    this.#disposePromise = this.#closePromise;
    try { this.#child.stdin.end(); } catch { /* Closing a failed pipe is harmless. */ }
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGTERM');
      const killTimer = setTimeout(() => this.#child.kill('SIGKILL'), 500);
      this.#closePromise.then(() => clearTimeout(killTimer));
    }
    return this.#disposePromise;
  }

  #request(method, params, signal) {
    if (this.#closed) return Promise.reject(historyError('HISTORY_CLOSED'));
    if (signal?.aborted) {
      this.#fail(historyError('HISTORY_CANCELLED'));
      return Promise.reject(historyError('HISTORY_CANCELLED'));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => this.#fail(historyError('HISTORY_CANCELLED'));
      const timer = setTimeout(() => this.#fail(historyError('HISTORY_TIMEOUT')), this.#timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      this.#pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#write({ id, method, params }).catch((error) => this.#fail(error));
    });
  }

  #write(message) {
    if (this.#closed) return Promise.reject(historyError('HISTORY_CLOSED'));
    return new Promise((resolve, reject) => {
      try {
        this.#child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (error) reject(historyError('HISTORY_IO_ERROR'));
          else resolve();
        });
      } catch {
        reject(historyError('HISTORY_IO_ERROR'));
      }
    });
  }

  #receive(chunk) {
    let start = 0;
    while (!this.#closed && start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      this.#lineBytes += end - start;
      if (this.#lineBytes > MAX_LINE_BYTES) {
        this.#fail(historyError('HISTORY_PROTOCOL_ERROR'));
        return;
      }
      this.#line += this.#decoder.write(chunk.subarray(start, end));
      if (newline < 0) return;
      const line = this.#line + this.#decoder.end();
      this.#line = '';
      this.#lineBytes = 0;
      this.#decoder = new StringDecoder('utf8');
      if (line.trim()) {
        let message;
        try { message = JSON.parse(line); }
        catch { this.#fail(historyError('HISTORY_PROTOCOL_ERROR')); return; }
        this.#handle(message);
      }
      start = end + 1;
    }
  }

  #handle(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      this.#fail(historyError('HISTORY_PROTOCOL_ERROR'));
      return;
    }
    if (typeof message.method === 'string') {
      if (Object.hasOwn(message, 'id')) {
        if (!['number', 'string'].includes(typeof message.id) && message.id !== null) {
          this.#fail(historyError('HISTORY_PROTOCOL_ERROR'));
          return;
        }
        this.#write({ id: message.id, error: { code: -32601, message: 'Method not found' } })
          .catch((error) => this.#fail(error));
      }
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    pending.cleanup();
    if (Object.hasOwn(message, 'error')) {
      const error = historyError('HISTORY_SERVER_ERROR');
      pending.reject(error);
      this.#fail(error);
    } else if (!Object.hasOwn(message, 'result')) {
      const error = historyError('HISTORY_PROTOCOL_ERROR');
      pending.reject(error);
      this.#fail(error);
    } else {
      pending.resolve(message.result);
    }
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #fail(error) {
    if (this.#closed) return;
    this.#rejectPending(error);
    this.dispose();
  }
}

module.exports = { HistoryClient };
