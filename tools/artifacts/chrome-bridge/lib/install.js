'use strict';

/**
 * What `action=install` puts on the machine, and how it compares with what is
 * there (ADR-0014 Decision 4). Everything lives outside the repo:
 *
 *   ~/.m-control/chrome-bridge/com.m_control.chrome_bridge.json   host manifest
 *   ~/.m-control/chrome-bridge/chrome-bridge-host.cmd             launcher (absolute paths)
 *   HKCU\Software\Google\Chrome\NativeMessagingHosts\com.m_control.chrome_bridge = <manifest>
 *
 * plan() is pure (paths and current state in, changes out), so it is tested on
 * every platform; the registry is only read and written through reg.exe.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { ToolFailure } = require('./protocol');

const HOST_NAME = 'com.m_control.chrome_bridge';
const REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
const LAUNCHER = 'chrome-bridge-host.cmd';

/** Chrome's extension id: the first 128 bits of sha256(public key DER), hex digits mapped to a-p. */
function extensionId(keyBase64) {
  const digest = crypto
    .createHash('sha256')
    .update(Buffer.from(keyBase64, 'base64'))
    .digest('hex');
  return digest
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

/** A path the .cmd launcher can quote safely: cmd.exe expands % even inside quotes. */
function cmdSafe(p, what) {
  if (/["%\r\n]/.test(p)) {
    throw new ToolFailure(
      `${what} path ${p} contains a quote, % or newline, which a .cmd launcher can't hold safely. ` +
        'Move it to a path without them.',
      'PATH_UNSUPPORTED'
    );
  }
  return p;
}

/** The files and registry value an install should leave, from absolute paths. */
function desired({ toolDir, stateDir, nodePath, mctlPath }) {
  const ext = JSON.parse(
    fs.readFileSync(path.join(toolDir, 'extension', 'manifest.json'), 'utf-8')
  );
  const id = extensionId(ext.key);
  const manifestFile = path.join(stateDir, `${HOST_NAME}.json`);
  const launcher = path.join(stateDir, LAUNCHER);
  const logFile = path.join(stateDir, 'host.log');
  const hostScript = path.join(toolDir, 'host', 'host.js');
  const hostManifest = {
    name: HOST_NAME,
    description:
      'm-control chrome-bridge: runs allowlisted browser actions through mctl',
    path: launcher,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${id}/`],
  };
  const cmd = [
    '@echo off',
    'rem Written by: mctl run chrome-bridge action=install. Chrome starts this; re-run the install instead of editing.',
    `"${cmdSafe(nodePath, 'Node')}" "${cmdSafe(hostScript, 'Host')}" --mctl "${cmdSafe(mctlPath, 'mctl')}" ` +
      `--log "${cmdSafe(logFile, 'Log')}" %*`,
    '',
  ].join('\r\n');
  return {
    extensionId: id,
    extensionDir: path.join(toolDir, 'extension'),
    logFile,
    files: [
      {
        path: manifestFile,
        content: JSON.stringify(hostManifest, null, 2) + '\n',
      },
      { path: launcher, content: cmd },
    ],
    registry: {
      key: process.env.M_CONTROL_CHROME_BRIDGE_REG_KEY || REG_KEY,
      value: manifestFile,
    },
  };
}

/**
 * Current state -> list of changes. `current` = {files: {path: content|undefined},
 * registry: value|undefined}. Each change: {target, kind, action}.
 */
function plan(action, want, current) {
  const changes = [];
  for (const f of want.files) {
    const have = current.files[f.path];
    if (action === 'install') {
      changes.push({
        kind: 'file',
        target: f.path,
        action:
          have === undefined
            ? 'create'
            : have === f.content
              ? 'unchanged'
              : 'update',
      });
    } else {
      changes.push({
        kind: 'file',
        target: f.path,
        action: have === undefined ? 'absent' : 'remove',
      });
    }
  }
  if (action === 'uninstall') {
    const log = current.files[want.logFile];
    changes.push({
      kind: 'file',
      target: want.logFile,
      action: log === undefined ? 'absent' : 'remove',
    });
  }
  const reg = current.registry;
  const target = `${want.registry.key} (Default)`;
  if (action === 'install') {
    changes.push({
      kind: 'registry',
      target,
      action:
        reg === undefined
          ? 'create'
          : reg === want.registry.value
            ? 'unchanged'
            : 'update',
      value: want.registry.value,
    });
  } else {
    changes.push({
      kind: 'registry',
      target,
      action: reg === undefined ? 'absent' : 'remove',
    });
  }
  return changes;
}

// ---------------------------------------------------------------- live state (Windows)

function reg(args) {
  const r = spawnSync('reg.exe', args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  if (r.error) {
    throw new ToolFailure(
      `Could not run reg.exe: ${r.error.message}`,
      'REGISTRY_FAILED'
    );
  }
  return r;
}

/** The key's default value, or undefined when the key doesn't exist. */
function readRegistry(key) {
  const r = reg(['query', key, '/ve']);
  if (r.status !== 0) return undefined;
  const line = r.stdout.split(/\r?\n/).find((l) => /\sREG_SZ\s/.test(l));
  return line ? line.split(/\s+REG_SZ\s+/)[1].trim() : undefined;
}

function writeRegistry(key, value) {
  const r = reg(['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f']);
  if (r.status !== 0) {
    throw new ToolFailure(
      `reg add ${key} failed: ${(r.stderr || r.stdout).trim()}`,
      'REGISTRY_FAILED'
    );
  }
}

function deleteRegistry(key) {
  const r = reg(['delete', key, '/f']);
  if (r.status !== 0) {
    throw new ToolFailure(
      `reg delete ${key} failed: ${(r.stderr || r.stdout).trim()}`,
      'REGISTRY_FAILED'
    );
  }
}

function readFile(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
}

function currentState(want) {
  const files = {};
  for (const p of [...want.files.map((f) => f.path), want.logFile])
    files[p] = readFile(p);
  return { files, registry: readRegistry(want.registry.key) };
}

/** Carry out the planned changes. */
function applyChanges(action, want, changes) {
  try {
    for (const f of want.files) {
      const c = changes.find((x) => x.target === f.path);
      if (c.action === 'create' || c.action === 'update') {
        fs.mkdirSync(path.dirname(f.path), { recursive: true });
        fs.writeFileSync(f.path, f.content);
      } else if (c.action === 'remove') {
        fs.rmSync(f.path);
      }
    }
    if (action === 'uninstall') {
      if (changes.find((x) => x.target === want.logFile).action === 'remove')
        fs.rmSync(want.logFile);
      for (const old of [`${want.logFile}.1`]) fs.rmSync(old, { force: true });
      const dir = path.dirname(want.logFile);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0)
        fs.rmdirSync(dir);
    }
  } catch (err) {
    if (err instanceof ToolFailure) throw err;
    throw new ToolFailure(
      `Could not write ${err.path || 'the host files'}: ${err.message}`,
      'WRITE_FAILED'
    );
  }
  const r = changes.find((x) => x.kind === 'registry');
  if (r.action === 'create' || r.action === 'update')
    writeRegistry(want.registry.key, want.registry.value);
  if (r.action === 'remove') deleteRegistry(want.registry.key);
}

module.exports = {
  HOST_NAME,
  REG_KEY,
  applyChanges,
  currentState,
  desired,
  extensionId,
  plan,
};
