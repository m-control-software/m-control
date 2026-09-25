'use strict';

const os = require('node:os');
const path = require('node:path');

const { ToolFailure } = require('./protocol');

/** The user's home directory, resolved the same way @m-control/core does. */
function homeDir() {
  return process.platform === 'win32'
    ? (process.env.USERPROFILE ?? os.homedir())
    : os.homedir();
}

/** Expands a leading `~` and resolves what is left against `base`. */
function resolveUserPath(value, base) {
  const expanded =
    value === '~' || value.startsWith('~/') || value.startsWith('~\\')
      ? path.join(homeDir(), value.slice(1))
      : value;
  return path.resolve(base, expanded);
}

/**
 * Reads an optional string config key and resolves it as a path relative to
 * the home directory. Returns undefined when the key is unset or empty.
 */
function configPath(config, key) {
  const value = config[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ToolFailure(
      `tools.${key} must be a path string, got ${JSON.stringify(value)}. ` +
        `Fix it in ~/.m-control/config.json.`,
      'CONFIG_INVALID'
    );
  }
  return resolveUserPath(value, homeDir());
}

module.exports = { configPath, homeDir, resolveUserPath };
