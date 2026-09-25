'use strict';

/**
 * Tool Protocol v1 helpers. stdout carries NDJSON ToolEvents only; everything
 * else a child process prints is forwarded to stderr by the caller.
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

/**
 * Logs progress of one transfer at most once per 10 % step and at most once
 * every `minIntervalMs`, so a long playlist stays far below the runner's
 * 10 000-event guardrail. A drop in the percentage means a new stream began
 * (video and audio are fetched separately before a merge).
 */
function createProgressReporter(label, minIntervalMs = 2000) {
  let bucket = 0;
  let lastAt = 0;
  let stream = 1;
  return {
    update(done, total) {
      if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) {
        return;
      }
      const pct = Math.min(100, Math.floor((done / total) * 100));
      const next = Math.floor(pct / 10);
      if (next < bucket) {
        stream += 1;
        bucket = next;
        return;
      }
      if (next <= bucket) return;
      bucket = next;
      const now = Date.now();
      if (now - lastAt < minIntervalMs) return;
      lastAt = now;
      const suffix = stream > 1 ? ` (stream ${stream})` : '';
      log('info', `${label}: ${pct}% of ${formatBytes(total)}${suffix}`);
    },
  };
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

module.exports = {
  TOOL_ID,
  ToolFailure,
  createProgressReporter,
  error,
  formatBytes,
  log,
  result,
  started,
};
