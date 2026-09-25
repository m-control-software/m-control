#!/usr/bin/env node
/**
 * tool-id — Tool Protocol v1 (Node.js template)
 *
 * stdin  <- JSON ToolRequest (read to EOF before doing any work)
 * stdout -> NDJSON ToolEvent lines ONLY (never raw console.log)
 * stderr -> raw diagnostic output (allowed, not parsed)
 * exit      0 = success, 1 = expected failure (after error event), >=2 = crash
 *
 * Tools are intentionally plain JS: no TypeScript, no build step, no
 * dependencies. Keep them standalone.
 *
 * The tool id and the required config keys come from manifest.json, so the
 * manifest stays the single source of truth for both.
 */

'use strict';

const manifest = require('./manifest.json');

const TOOL_ID = manifest.id;

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------

function emit(type, payload) {
  process.stdout.write(
    JSON.stringify({
      type,
      ts: new Date().toISOString(),
      toolId: TOOL_ID,
      payload,
    }) + '\n'
  );
}

const started = (meta = {}) => emit('started', { meta });
const log = (level, message, data) =>
  emit('log', { level, message, ...(data !== undefined ? { data } : {}) });
const result = (payload) => emit('result', payload);
const error = (message, code, recoverable) =>
  emit('error', { message, code, recoverable });

/** An expected failure the user can act on (or not): error event, exit 1. */
class ToolFailure extends Error {
  constructor(message, code, recoverable = true) {
    super(message);
    this.code = code;
    this.recoverable = recoverable;
  }
}

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
 * applies. Nothing enforces requiredConfig at run time, so the tool must.
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  started();

  const { context, input = {} } = await readRequest();
  const config = context.config || {};
  requireConfig(config);

  log('info', `Running in workspace: ${context.workspaceRoot}`);

  // TODO: implement the tool. `input` holds `mctl run tool-id key=value`
  // pairs, always as strings. `config` holds every key the manifest declares,
  // keyed by dot-path (e.g. config['tool-id.apiKey']).

  result({ message: 'TODO: implement me', input });
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
