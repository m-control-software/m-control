#!/usr/bin/env node
/**
 * <tool-id> — Tool Protocol v1 (Node.js template)
 *
 * stdin  <- JSON ToolRequest (read to EOF before doing any work)
 * stdout -> NDJSON ToolEvent lines ONLY (never raw console.log)
 * stderr -> raw diagnostic output (allowed, not parsed)
 * exit      0 = success, 1 = expected failure (after error event), >=2 = crash
 *
 * Tools are intentionally plain JS: no TypeScript, no build step, minimal
 * dependencies. Keep them standalone.
 */

'use strict';

const TOOL_ID = 'tool-id'; // must match manifest.id

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------

function emit(type, payload) {
  process.stdout.write(
    JSON.stringify({ type, ts: new Date().toISOString(), toolId: TOOL_ID, payload }) + '\n'
  );
}

const started = (meta = {}) => emit('started', { meta });
const log = (level, message, data) =>
  emit('log', { level, message, ...(data !== undefined ? { data } : {}) });
const result = (payload) => emit('result', payload);
const error = (message, code, recoverable = true) =>
  emit('error', { message, code, recoverable });

function readRequest() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (err) {
        reject(new Error(`Failed to parse ToolRequest from stdin: ${err.message}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  started();

  let request;
  try {
    request = await readRequest();
  } catch (err) {
    error(err.message, 'INVALID_REQUEST', false);
    process.exit(1);
  }

  const { context, input } = request;

  // Config values requested via manifest.requiredConfig arrive as a flat map:
  //   context.config['my-service.token']
  // Validate them early and emit a recoverable error if missing:
  //
  // const token = context.config['my-service.token'];
  // if (!token) {
  //   error('Missing config: tools.my-service.token in ~/.m-control/config.json', 'CONFIG_MISSING', true);
  //   process.exit(1);
  // }

  log('info', `Running in workspace: ${context.workspaceRoot}`);

  // TODO: implement tool logic here. `input` holds key=value args from
  // `mctl run tool-id key=value`.

  result({ message: 'TODO: implement me', input });
  process.exit(0);
}

main().catch((err) => {
  error(`Unhandled error: ${err.message}`, 'UNHANDLED_ERROR', false);
  process.exit(2);
});
