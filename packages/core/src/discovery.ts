import * as fs from 'fs';
import * as path from 'path';
import { ToolManifest, MANIFEST_VERSION } from './types';
import { DiscoveryError, ManifestError } from './errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredTool {
  manifest: ToolManifest;
  /** Absolute path to the directory containing manifest.json */
  dir: string;
  /** Absolute path to the entry point (manifest.entry resolved from dir) */
  entryPath: string;
}

export interface DiscoveryResult {
  tools: DiscoveredTool[];
  /** Manifests that failed to load/validate — non-fatal, logged as warnings */
  errors: Array<{ file: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Scan one or more tools root directories recursively for manifest.json files.
 *
 * Structure expected:
 *   <toolsRoot>/<category>/<tool-id>/manifest.json
 *
 * Multiple roots: earlier roots win on tool id collisions — the duplicate
 * is skipped and reported in result.errors.
 *
 * Non-fatal errors (bad manifests, duplicates) are collected in
 * result.errors. Fatal errors (a root exists but is not a directory)
 * throw DiscoveryError. Missing roots are treated as empty.
 */
export function discoverTools(toolsRoot: string | string[]): DiscoveryResult {
  const roots = Array.isArray(toolsRoot) ? toolsRoot : [toolsRoot];

  const tools: DiscoveredTool[] = [];
  const errors: DiscoveryResult['errors'] = [];
  const seen = new Map<string, string>(); // tool id -> manifest path

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      // Not an error if a root doesn't exist yet — treat as empty
      continue;
    }

    const stat = fs.statSync(root);
    if (!stat.isDirectory()) {
      throw new DiscoveryError(`Tools root is not a directory: ${root}`);
    }

    for (const file of findManifests(root)) {
      try {
        const discovered = loadManifest(file);
        const existing = seen.get(discovered.manifest.id);
        if (existing) {
          errors.push({
            file,
            error: `duplicate tool id "${discovered.manifest.id}" — already defined by ${existing}`,
          });
          continue;
        }
        seen.set(discovered.manifest.id, file);
        tools.push(discovered);
      } catch (err) {
        errors.push({
          file,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Stable sort by id — deterministic output for `mctl list`
  tools.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));

  return { tools, errors };
}

/**
 * Load and validate a single manifest file.
 * Throws ManifestError if the file is invalid.
 */
export function loadManifest(manifestPath: string): DiscoveredTool {
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    throw new ManifestError(
      `Cannot read manifest at ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ManifestError(
      `Invalid JSON in manifest ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const manifest = validateManifest(parsed, manifestPath);
  const dir = path.dirname(manifestPath);
  const entryPath = path.resolve(dir, manifest.entry);

  return { manifest, dir, entryPath };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Recursively find all manifest.json files under dir. */
function findManifests(dir: string): string[] {
  const results: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...findManifests(fullPath));
    } else if (entry.isFile() && entry.name === 'manifest.json') {
      results.push(fullPath);
    }
  }

  return results;
}

/** Validate parsed JSON against ToolManifest shape. Returns typed manifest or throws. */
function validateManifest(raw: unknown, filePath: string): ToolManifest {
  const err = (msg: string): never => {
    throw new ManifestError(`Invalid manifest at ${filePath}: ${msg}`);
  };

  if (typeof raw !== 'object' || raw === null) {
    err('root must be a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  // manifestVersion — checked first so we can give a clear version mismatch error
  if (obj['manifestVersion'] !== MANIFEST_VERSION) {
    err(
      `unsupported manifestVersion: ${String(obj['manifestVersion'])}. ` +
        `Expected ${MANIFEST_VERSION}. Update the tool or the orchestrator.`
    );
  }

  const required: Array<[keyof ToolManifest, string]> = [
    ['id', 'string'],
    ['version', 'string'],
    ['name', 'string'],
    ['description', 'string'],
    ['runtime', 'string'],
    ['entry', 'string'],
  ];

  for (const [field, type] of required) {
    if (typeof obj[field] !== type) {
      err(`field "${field}" must be a ${type}, got ${typeof obj[field]}`);
    }
  }

  const validRuntimes = ['node', 'python', 'dotnet', 'powershell'];
  if (!validRuntimes.includes(obj['runtime'] as string)) {
    err(
      `unknown runtime "${String(obj['runtime'])}". Valid: ${validRuntimes.join(', ')}`
    );
  }

  // id must be kebab-case
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(obj['id'] as string)) {
    err(`id "${String(obj['id'])}" must be kebab-case (e.g. "my-tool")`);
  }

  return obj as unknown as ToolManifest;
}
