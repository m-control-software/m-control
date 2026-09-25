// PostToolUse hook (Claude Code) for Edit|Write|MultiEdit. Registered in
// .claude/settings.json.
//
// Formats the file an agent just wrote with the repo's Prettier config, so
// `yarn lint` never fails on formatting and diffs stay free of style noise.
// Only TS/JS the repo lints; never blocks the agent (always exits 0; problems
// go to stderr).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, sep } from 'node:path';

const FORMATTED = new Set(['.ts', '.js', '.mjs']);

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf-8'));
  } catch {
    return {};
  }
}

const file = readStdin().tool_input?.file_path;
if (
  typeof file !== 'string' ||
  !FORMATTED.has(extname(file)) ||
  file
    .split(/[\\/]/)
    .some((part) => part === 'node_modules' || part === 'dist') ||
  !existsSync(file)
) {
  process.exit(0);
}

try {
  const prettier = createRequire(
    new URL('../../package.json', import.meta.url)
  )('prettier');
  const source = readFileSync(file, 'utf-8');
  const options = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, {
    ...options,
    filepath: file,
  });
  if (formatted !== source) writeFileSync(file, formatted);
} catch (err) {
  process.stderr.write(
    `format hook: could not format ${file.split(sep).pop()}: ${err instanceof Error ? err.message : String(err)}\n`
  );
}
