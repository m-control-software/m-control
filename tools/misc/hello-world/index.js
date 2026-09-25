#!/usr/bin/env node
/**
 * hello-world — Tool Protocol v1 reference implementation.
 *
 * stdin  <- JSON ToolRequest
 * stdout -> NDJSON ToolEvent stream
 * stderr -> raw diagnostic logs (if any)
 * exit      0 = success
 *
 * This is intentionally plain JS (no TypeScript, no build step).
 * Tools are standalone processes — they should have minimal dependencies.
 */

'use strict';

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------

function emit(type, payload) {
  const event = {
    type,
    ts: new Date().toISOString(),
    toolId: 'hello-world',
    payload,
  };
  process.stdout.write(JSON.stringify(event) + '\n');
}

const started = (meta = {}) => emit('started', { meta });
const log = (level, message, data) =>
  emit('log', { level, message, ...(data !== undefined ? { data } : {}) });
const result = (payload) => emit('result', payload);
const error = (message, code, recoverable = true) =>
  emit('error', { message, code, recoverable });

// ---------------------------------------------------------------------------
// Read stdin to EOF and parse ToolRequest
// ---------------------------------------------------------------------------

async function readRequest() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(
          new Error(`Failed to parse ToolRequest from stdin: ${err.message}`)
        );
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

  log('info', `Running in workspace: ${context.workspaceRoot}`);

  // Simulate doing actual work
  const name = input && input.name ? String(input.name) : 'World';
  log('info', `Hello, ${name}!`);

  // Demonstrate data in log payload
  log('debug', 'Tool context received', {
    toolId: context.toolId,
    configKeys: Object.keys(context.config ?? {}),
  });

  result({
    message: `Hello, ${name}!`,
    toolId: context.toolId,
  });

  process.exit(0);
}

main().catch((err) => {
  error(`Unhandled error: ${err.message}`, 'UNHANDLED_ERROR', false);
  process.exit(2);
});
