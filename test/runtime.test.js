'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { historyOptions } = require('../src/runtime');

test('history uses the official bundled binary on the SSH host', () => {
  const options = historyOptions({ extensionPath: '/official', platform: 'linux', arch: 'x64', cwd: '/workspace' });
  assert.equal(options.executable, '/official/bin/linux-x86_64/codex');
  assert.equal(options.cwd, '/workspace');
  assert.equal(options.args[0], 'app-server');
});

test('an executable override is one path, not a shell command line', () => {
  const options = historyOptions({ cliPath: '/tools/my codex', officialCliPath: '/ignored', extensionPath: '/official' });
  assert.equal(options.executable, '/tools/my codex');
  assert.equal(options.args.includes('/tools/my'), false);
});

test('official CLI override is reused when no companion override is set', () => {
  assert.equal(historyOptions({ officialCliPath: '/custom/codex', extensionPath: '/official' }).executable, '/custom/codex');
});

test('history helper disables telemetry transiently without a config-file edit', () => {
  const { args } = historyOptions({ extensionPath: '/official', platform: 'linux', arch: 'x64' });
  for (const setting of ['analytics.enabled=false', 'otel.exporter="none"', 'otel.trace_exporter="none"', 'otel.metrics_exporter="none"']) {
    const index = args.indexOf(setting);
    assert.ok(index > 0);
    assert.equal(args[index - 1], '-c');
  }
});
