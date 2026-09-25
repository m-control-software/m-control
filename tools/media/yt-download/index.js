#!/usr/bin/env node
/**
 * yt-download — Tool Protocol v1.
 *
 * Downloads YouTube videos (mp4) or audio (mp3) with yt-dlp + ffmpeg, both
 * pinned by version and SHA-256 in deps.json and installed by `action=setup`.
 * See README.md for input, config and the dependency model.
 *
 * stdin  <- JSON ToolRequest (read to EOF before doing any work)
 * stdout -> NDJSON ToolEvent lines ONLY (lib/protocol.js)
 * stderr -> yt-dlp's own output and diagnostics
 * exit      0 = success, 1 = expected failure (after error event), >=2 = crash
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const manifest = require('./manifest.json');
const { ToolFailure, error, log, result, started } = require('./lib/protocol');
const { configPath, homeDir, resolveUserPath } = require('./lib/paths');
const deps = require('./lib/deps');
const ytdlp = require('./lib/ytdlp');

/** yt-dlp supports Node as its JavaScript runtime from this major on. */
const MIN_NODE_MAJOR = 22;

const INPUT_KEYS = {
  download: [
    'action',
    'url',
    'format',
    'maxHeight',
    'playlist',
    'outDir',
    'check',
  ],
  setup: ['action', 'check'],
};

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
 * applies. This tool declares none today; the check stays so adding one is
 * enforced without further code.
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

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const invalid = (message) => new ToolFailure(message, 'INPUT_INVALID');

function oneOf(input, key, allowed, fallback) {
  const v = input[key];
  if (v === undefined || v === '') return fallback;
  if (!allowed.includes(v)) {
    throw invalid(
      `${key}=${v} is not valid; use one of: ${allowed.join(', ')}.`
    );
  }
  return v;
}

function bool(input, key) {
  const v = input[key];
  if (v === undefined || v === '') return false;
  if (v === 'true' || v === true) return true;
  if (v === 'false' || v === false) return false;
  throw invalid(`${key}=${v} is not valid; use ${key}=true or ${key}=false.`);
}

function parseInput(input, workspaceRoot) {
  const action = oneOf(input, 'action', ['download', 'setup'], 'download');
  const unknown = Object.keys(input).filter(
    (k) => !INPUT_KEYS[action].includes(k)
  );
  if (unknown.length > 0) {
    throw invalid(
      `Unknown input for action=${action}: ${unknown.join(', ')}. ` +
        `Allowed: ${INPUT_KEYS[action].join(', ')}.`
    );
  }
  const check = bool(input, 'check');
  if (action === 'setup') return { action, check };

  const url = input.url;
  if (typeof url !== 'string' || url === '') {
    throw invalid(
      'url is required, e.g. mctl run yt-download url=https://youtu.be/<id>'
    );
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid(`url=${url} is not a URL.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw invalid(`url=${url} must be an http(s) URL.`);
  }

  const format = oneOf(input, 'format', ['video', 'audio'], 'video');
  let maxHeight;
  if (input.maxHeight !== undefined && input.maxHeight !== '') {
    if (format !== 'video') {
      throw invalid('maxHeight applies to format=video only.');
    }
    if (!/^[1-9][0-9]{0,4}$/.test(String(input.maxHeight))) {
      throw invalid(
        `maxHeight=${input.maxHeight} is not valid; use a height in pixels, e.g. maxHeight=1080.`
      );
    }
    maxHeight = Number(input.maxHeight);
  }

  let outDir;
  if (input.outDir !== undefined) {
    if (typeof input.outDir !== 'string' || input.outDir === '') {
      throw invalid('outDir must be a directory path.');
    }
    outDir = resolveUserPath(input.outDir, workspaceRoot);
  }

  return {
    action,
    check,
    url,
    format,
    maxHeight,
    playlist: bool(input, 'playlist'),
    outDir,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function requireNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    throw new ToolFailure(
      `yt-dlp needs Node ${MIN_NODE_MAJOR}+ as its JavaScript runtime for ` +
        `YouTube; mctl is running on Node ${process.versions.node}. ` +
        `Upgrade Node (the repo's .nvmrc pins the tested version).`,
      'NODE_TOO_OLD'
    );
  }
}

/** Creates the output directory and proves it is writable. */
function prepareOutputDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (err) {
    throw new ToolFailure(
      `Cannot write to ${dir}: ${err.message}. Choose another outDir= or ` +
        `set tools.yt-download.outputDir.`,
      'OUTPUT_DIR_UNWRITABLE'
    );
  }
}

async function download(opts, config) {
  requireNode();
  // Validate the output location before looking for binaries, so a config
  // mistake is reported ahead of a missing setup.
  const outputDir =
    opts.outDir ??
    configPath(config, 'yt-download.outputDir') ??
    path.join(homeDir(), 'Downloads');
  const pins = deps.loadDeps();
  const bins = deps.resolveBinaries(config, pins);
  const ytDlpVersion =
    bins['yt-dlp'].source === 'managed'
      ? bins['yt-dlp'].version
      : ytdlp.versionOf(bins['yt-dlp'].path);

  if (!opts.check) prepareOutputDir(outputDir);

  log(
    'info',
    `${opts.check ? 'Checking' : 'Downloading'} ${opts.url} as ` +
      `${opts.format === 'audio' ? 'mp3' : 'mp4'} with yt-dlp ${ytDlpVersion}`
  );

  const outcome = await ytdlp.run(
    bins['yt-dlp'].path,
    ytdlp.buildArgs({
      ...opts,
      outDir: outputDir,
      ffmpeg: bins.ffmpeg.path,
      node: process.execPath,
    }),
    ytDlpVersion
  );

  const common = {
    outputDir,
    format: opts.format,
    ytDlp: { version: ytDlpVersion, source: bins['yt-dlp'].source },
  };

  if (outcome.exitCode === 0) {
    if (opts.check) {
      return { check: true, ...common, items: outcome.plans };
    }
    if (outcome.items.length === 0) {
      log('warn', 'yt-dlp finished without saving anything.');
    }
    return { ...common, items: outcome.items, failed: [] };
  }

  const produced = opts.check ? outcome.plans : outcome.items;
  if (produced.length > 0) {
    log(
      'warn',
      `${outcome.failed.length} item(s) failed; ${produced.length} succeeded. ` +
        `See 'failed' in the result.`
    );
    return opts.check
      ? { check: true, ...common, items: produced, failed: outcome.failed }
      : { ...common, items: produced, failed: outcome.failed };
  }

  const first = outcome.failed[0];
  if (first) {
    throw new ToolFailure(first.message, first.code, first.recoverable);
  }
  throw new ToolFailure(
    `yt-dlp exited with ${outcome.signal ?? `code ${outcome.exitCode}`}: ` +
      `${outcome.stderrTail.slice(-5).join(' | ') || 'no output'}`,
    'YTDLP_FAILED',
    false
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  started();

  const { context, input = {} } = await readRequest();
  const config = context.config || {};
  requireConfig(config);

  const opts = parseInput(input, context.workspaceRoot || process.cwd());
  if (opts.action === 'setup') {
    result(await deps.setup(config, deps.loadDeps(), opts.check));
  } else {
    result(await download(opts, config));
  }
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
