#!/usr/bin/env node
/**
 * chrome-bridge — Tool Protocol v1 (ADR-0014).
 *
 * Installs (or removes) the native messaging host that lets the m-control
 * bridge Chrome extension (./extension, loaded unpacked) run allowlisted
 * actions through mctl. The host itself is ./host/host.js; Chrome starts it,
 * not mctl. See README.md.
 *
 *     mctl run chrome-bridge action=install [check=true]
 *     mctl run chrome-bridge action=uninstall [check=true]
 *
 * stdin  <- JSON ToolRequest (read to EOF before doing any work)
 * stdout -> NDJSON ToolEvent lines ONLY (lib/protocol.js)
 * exit      0 = success, 1 = expected failure (after error event), >=2 = crash
 */

'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const manifest = require('./manifest.json');
const { ToolFailure, error, log, result, started } = require('./lib/protocol');
const install = require('./lib/install');

const INPUT_KEYS = ['action', 'check'];
const ACTIONS = ['install', 'uninstall'];

function readRequest() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (err) {
        // mctl always sends valid JSON, so a parse failure is a bug upstream.
        reject(
          new ToolFailure(
            `Failed to parse ToolRequest from stdin: ${err.message}`,
            'INVALID_REQUEST',
            false
          )
        );
      }
    });
    process.stdin.on('error', reject);
  });
}

/**
 * Fails with a recoverable CONFIG_MISSING error when any key the manifest
 * declares in requiredConfig is unset or empty — the same rule `mctl doctor`
 * applies. This tool declares none; the check stays so adding one is enforced.
 */
function requireConfig(config) {
  const missing = (manifest.requiredConfig || []).filter((key) => {
    const v = config[key];
    return v === undefined || v === null || v === '';
  });
  if (missing.length > 0) {
    throw new ToolFailure(
      `Missing required config: ${missing.map((k) => `tools.${k}`).join(', ')}. ` +
        `Set it in ~/.m-control/config.json (see this tool's README), then run 'mctl doctor'.`,
      'CONFIG_MISSING'
    );
  }
}

function homeDir() {
  return process.platform === 'win32'
    ? (process.env.USERPROFILE ?? os.homedir())
    : os.homedir();
}

function parseBool(value, key) {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ToolFailure(
    `${key} must be true or false, got ${JSON.stringify(value)}.`,
    'INPUT_INVALID'
  );
}

function parseInput(input) {
  const unknown = Object.keys(input).filter((k) => !INPUT_KEYS.includes(k));
  if (unknown.length) {
    throw new ToolFailure(
      `Unknown input ${unknown.join(', ')}. Valid keys: ${INPUT_KEYS.join(', ')}.`,
      'INPUT_INVALID'
    );
  }
  if (!ACTIONS.includes(input.action)) {
    throw new ToolFailure(
      `action must be ${ACTIONS.join(' or ')}, e.g. mctl run chrome-bridge action=install` +
        (input.action ? ` (got ${JSON.stringify(input.action)})` : ''),
      'INPUT_INVALID'
    );
  }
  return { action: input.action, check: parseBool(input.check, 'check') };
}

function mctlPath(config) {
  const v = config['chrome-bridge.mctlPath'];
  if (v !== undefined && v !== null && v !== '' && typeof v !== 'string') {
    throw new ToolFailure(
      `tools.chrome-bridge.mctlPath must be a path string, got ${JSON.stringify(v)}.`,
      'CONFIG_INVALID'
    );
  }
  const raw = v || '~/.m-control/mctl.js';
  const expanded =
    raw === '~' || /^~[\\/]/.test(raw)
      ? path.join(homeDir(), raw.slice(1))
      : raw;
  return path.resolve(homeDir(), expanded);
}

function nextSteps(want) {
  return [
    'In Chrome: chrome://extensions, turn on Developer mode, then "Load unpacked" and pick ' +
      want.extensionDir,
    `Check that the extension id is ${want.extensionId}.`,
    'Check chrome://extensions/shortcuts: "Save this YouTube / YouTube Music track as mp3" should be Ctrl+Shift+Y ' +
      '(Chrome skips a suggested shortcut that is already taken).',
  ];
}

async function main() {
  started();
  const { context, input = {} } = await readRequest();
  const config = context.config || {};
  requireConfig(config);
  const { action, check } = parseInput(input);

  if (process.platform !== 'win32') {
    throw new ToolFailure(
      'chrome-bridge installs through the Windows registry (v1). On macOS and Linux Chrome reads host manifests ' +
        'from a directory instead; see README.md.',
      'UNSUPPORTED_PLATFORM'
    );
  }
  const mctl = mctlPath(config);
  if (action === 'install' && !fs.existsSync(mctl)) {
    throw new ToolFailure(
      `mctl not found at ${mctl}. Install it (scripts/install.ps1) or set tools.chrome-bridge.mctlPath.`,
      'MCTL_NOT_FOUND'
    );
  }

  const want = install.desired({
    toolDir: __dirname,
    stateDir: path.join(homeDir(), '.m-control', 'chrome-bridge'),
    nodePath: process.execPath,
    mctlPath: mctl,
  });
  const changes = install.plan(action, want, install.currentState(want));
  const pending = changes.filter(
    (c) => !['unchanged', 'absent'].includes(c.action)
  );
  for (const c of pending)
    log('info', `${check ? 'would ' : ''}${c.action} ${c.target}`);

  if (!check && pending.length) {
    install.applyChanges(action, want, changes);
    const after = install.plan(action, want, install.currentState(want));
    const left = after.filter(
      (c) => !['unchanged', 'absent'].includes(c.action)
    );
    if (left.length) {
      throw new ToolFailure(
        `After the ${action}, ${left.map((c) => c.target).join(', ')} still differ. Run it again, or check permissions.`,
        'VERIFY_FAILED'
      );
    }
  }
  if (!pending.length)
    log(
      'info',
      `already ${action === 'install' ? 'installed' : 'removed'}; nothing to do`
    );

  result({
    action,
    check,
    changed: !check && pending.length > 0,
    hostName: install.HOST_NAME,
    extensionId: want.extensionId,
    extensionDir: want.extensionDir,
    mctlPath: mctl,
    nodePath: process.execPath,
    changes,
    ...(action === 'install' ? { nextSteps: nextSteps(want) } : {}),
  });
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (err) => {
    if (err instanceof ToolFailure) {
      error(err.message, err.code, err.recoverable);
      process.exitCode = 1;
    } else {
      error(
        `Unhandled error: ${err && err.stack ? err.stack : err}`,
        'UNHANDLED_ERROR',
        false
      );
      process.exitCode = 2;
    }
  }
);
