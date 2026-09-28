'use strict';

/**
 * Tool Protocol v1 helpers. stdout carries NDJSON ToolEvents only.
 */

const manifest = require('../manifest.json');

const TOOL_ID = manifest.id;

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

module.exports = { ToolFailure, error, log, result, started };
