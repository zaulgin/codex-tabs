'use strict';
const path = require('node:path');

function historyOptions({ extensionPath, cliPath, officialCliPath, cwd, platform = process.platform, arch = process.arch }) {
  let executable = cliPath?.trim() || officialCliPath?.trim();
  if (!executable) {
    const os = { linux: 'linux', darwin: 'macos', win32: 'windows' }[platform];
    const cpu = { x64: 'x86_64', arm64: 'aarch64' }[arch];
    if (!os || !cpu) throw new Error('Set codexTabs.cliPath for this platform.');
    executable = path.join(extensionPath, 'bin', `${os}-${cpu}`, platform === 'win32' ? 'codex.exe' : 'codex');
  }
  return {
    executable,
    cwd,
    args: [
      'app-server',
      '-c', 'analytics.enabled=false',
      '-c', 'otel.exporter="none"',
      '-c', 'otel.trace_exporter="none"',
      '-c', 'otel.metrics_exporter="none"',
    ],
  };
}

module.exports = { historyOptions };
