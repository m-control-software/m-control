'use strict';

/**
 * External binaries (yt-dlp, ffmpeg): pinned in deps.json, installed by
 * `action=setup` into <depsDir>/<name>/<version>/, and resolved for a run.
 *
 * Resolution order per binary: the path configured in tools.yt-download.*,
 * then the managed install of the pinned version. PATH is never searched, so
 * a run always uses a known version.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const {
  ToolFailure,
  createProgressReporter,
  formatBytes,
  log,
} = require('./protocol');
const { configPath, homeDir } = require('./paths');

/** Overrides the location of deps.json; used by tests to pin local assets. */
const DEPS_FILE_ENV = 'M_CONTROL_YT_DOWNLOAD_DEPS';

const DEPS = [
  { name: 'yt-dlp', configKey: 'yt-download.ytDlpPath' },
  { name: 'ffmpeg', configKey: 'yt-download.ffmpegPath' },
];

/** Abort a download that has received no data for this long. */
const STALL_MS = 60_000;
/** Leftovers of a killed setup older than this are removed. */
const STALE_TMP_MS = 60 * 60 * 1000;
const SHA256 = /^[0-9a-f]{64}$/;

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function depsDir(config) {
  return (
    configPath(config, 'yt-download.depsDir') ??
    path.join(homeDir(), '.m-control', 'deps')
  );
}

function manifestError(file, detail) {
  return new ToolFailure(
    `Invalid dependency pins in ${file}: ${detail}. This is a bug in the ` +
      `tool's deps.json — fix the pin (README -> Updating the pins).`,
    'DEPS_MANIFEST_INVALID',
    false
  );
}

/** Reads and validates deps.json. */
function loadDeps() {
  const file =
    process.env[DEPS_FILE_ENV] || path.join(__dirname, '..', 'deps.json');
  let deps;
  try {
    deps = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    throw manifestError(file, err.message);
  }
  for (const { name } of DEPS) {
    const dep = deps[name];
    if (!dep || typeof dep.version !== 'string' || !dep.platforms) {
      throw manifestError(file, `'${name}' needs a version and platforms`);
    }
    for (const [key, entry] of Object.entries(dep.platforms)) {
      const where = `${name}.platforms.${key}`;
      if (typeof entry.url !== 'string' || !SHA256.test(entry.sha256 ?? '')) {
        throw manifestError(file, `${where} needs a url and a sha256`);
      }
      if (entry.archive === undefined) {
        if (typeof entry.file !== 'string') {
          throw manifestError(file, `${where} needs 'file'`);
        }
      } else if (
        !['zip', 'tar.xz'].includes(entry.archive) ||
        typeof entry.binDir !== 'string' ||
        !Array.isArray(entry.files) ||
        entry.files.length === 0
      ) {
        throw manifestError(
          file,
          `${where} is an archive and needs archive (zip|tar.xz), binDir and files`
        );
      }
    }
  }
  return deps;
}

/** The files an entry installs, relative to its install directory. */
function entryFiles(entry) {
  return entry.archive === undefined ? [entry.file] : entry.files;
}

function isInstalled(dir, entry) {
  return entryFiles(entry).every((f) => fs.existsSync(path.join(dir, f)));
}

/** What each dependency resolves to on this machine, without failing. */
function inspect(config, deps) {
  const key = platformKey();
  const root = depsDir(config);
  return DEPS.map(({ name, configKey }) => {
    const configured = configPath(config, configKey);
    const version = deps[name].version;
    const entry = deps[name].platforms[key];
    const dir = path.join(root, name, version);
    return {
      name,
      configKey,
      configured,
      version,
      entry,
      dir,
      installed: entry !== undefined && isInstalled(dir, entry),
    };
  });
}

/**
 * Resolves the binaries a download needs. Fails with one message naming
 * everything that is missing, and how to fix each.
 */
function resolveBinaries(config, deps) {
  const found = {};
  const missing = [];
  const unsupported = [];
  for (const dep of inspect(config, deps)) {
    if (dep.configured !== undefined) {
      if (!fs.existsSync(dep.configured)) {
        throw new ToolFailure(
          `tools.${dep.configKey} points at ${dep.configured}, which does not ` +
            `exist. Fix the path, or remove the key to use the managed ` +
            `${dep.name} (mctl run yt-download action=setup).`,
          'CONFIG_INVALID'
        );
      }
      found[dep.name] = { path: dep.configured, source: 'config' };
    } else if (dep.entry === undefined) {
      unsupported.push(dep);
    } else if (!dep.installed) {
      missing.push(dep);
    } else {
      const file = dep.entry.archive === undefined ? dep.entry.file : null;
      found[dep.name] = {
        // yt-dlp takes ffmpeg's directory, so ffprobe is found next to it.
        path: file ? path.join(dep.dir, file) : dep.dir,
        source: 'managed',
        version: dep.version,
      };
    }
  }
  if (unsupported.length > 0) {
    throw unsupportedFailure(unsupported);
  }
  if (missing.length > 0) {
    throw new ToolFailure(
      `${missing.map((d) => `${d.name} ${d.version}`).join(' and ')} ` +
        `${missing.length > 1 ? 'are' : 'is'} not installed. Run ` +
        `'mctl run yt-download action=setup' (downloads the pinned, ` +
        `checksum-verified binaries), or set ` +
        `${missing.map((d) => `tools.${d.configKey}`).join(' / ')} to your own.`,
      'DEPS_MISSING'
    );
  }
  return found;
}

function unsupportedFailure(deps) {
  return new ToolFailure(
    `No pinned ${deps.map((d) => d.name).join(' or ')} build for ` +
      `${platformKey()}. Install it yourself and set ` +
      `${deps.map((d) => `tools.${d.configKey}`).join(' / ')} in ` +
      `~/.m-control/config.json.`,
    'UNSUPPORTED_PLATFORM'
  );
}

/**
 * action=setup: installs every pinned dependency that is not configured to a
 * custom path and not installed yet. Idempotent; `check` only reports.
 */
async function setup(config, deps, check) {
  const deps_ = inspect(config, deps);
  const skipped = deps_
    .filter((d) => d.configured !== undefined)
    .map((d) => ({ name: d.name, reason: 'configured', path: d.configured }));
  const managed = deps_.filter((d) => d.configured === undefined);
  const unsupported = managed.filter((d) => d.entry === undefined);
  if (unsupported.length > 0) throw unsupportedFailure(unsupported);

  const describe = (d) => ({
    name: d.name,
    version: d.version,
    path: d.dir,
    url: d.entry.url,
    sha256: d.entry.sha256,
  });
  const alreadyPresent = managed.filter((d) => d.installed).map(describe);
  const toInstall = managed.filter((d) => !d.installed);

  if (check) {
    for (const d of toInstall) {
      log('info', `Would install ${d.name} ${d.version} from ${d.entry.url}`);
    }
    return {
      check: true,
      platform: platformKey(),
      depsDir: depsDir(config),
      toInstall: toInstall.map(describe),
      alreadyPresent,
      skipped,
    };
  }

  const installed = [];
  for (const d of toInstall) {
    await install(d);
    installed.push(describe(d));
  }
  if (toInstall.length === 0) {
    log('info', 'All dependencies are already installed.');
  }
  return {
    platform: platformKey(),
    depsDir: depsDir(config),
    installed,
    alreadyPresent,
    skipped,
  };
}

/**
 * Downloads, verifies and (for archives) extracts one dependency into a
 * temporary directory next to its target, then renames it into place. The
 * target either holds a complete, verified install or does not exist.
 */
async function install(dep) {
  const parent = path.dirname(dep.dir);
  fs.mkdirSync(parent, { recursive: true });
  sweepStale(parent);
  const tmp = fs.mkdtempSync(path.join(parent, `.tmp-${dep.version}-`));
  try {
    const download = path.join(tmp, 'download');
    const stage = path.join(tmp, 'stage');
    fs.mkdirSync(stage);
    const label = `${dep.name} ${dep.version}`;
    await downloadVerified(dep.entry, download, label);

    if (dep.entry.archive === undefined) {
      fs.renameSync(download, path.join(stage, dep.entry.file));
    } else {
      const extracted = path.join(tmp, 'extracted');
      fs.mkdirSync(extracted);
      log('info', `Extracting ${label}`);
      const members = dep.entry.files.map((f) => `${dep.entry.binDir}/${f}`);
      extract(download, extracted, members, label);
      for (const f of dep.entry.files) {
        const from = path.join(extracted, ...dep.entry.binDir.split('/'), f);
        if (!fs.existsSync(from)) {
          throw new ToolFailure(
            `${label}: the archive has no ${dep.entry.binDir}/${f}. The pin's ` +
              `binDir/files do not match the release — fix deps.json.`,
            'DEPS_MANIFEST_INVALID',
            false
          );
        }
        fs.renameSync(from, path.join(stage, f));
      }
    }
    if (process.platform !== 'win32') {
      for (const f of entryFiles(dep.entry)) {
        fs.chmodSync(path.join(stage, f), 0o755);
      }
    }
    fs.writeFileSync(
      path.join(stage, 'install.json'),
      JSON.stringify(
        {
          name: dep.name,
          version: dep.version,
          url: dep.entry.url,
          sha256: dep.entry.sha256,
          installedAt: new Date().toISOString(),
        },
        null,
        2
      ) + '\n'
    );
    moveIntoPlace(stage, dep);
    log('info', `Installed ${label} into ${dep.dir}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Renames the staged install onto its target. Windows antivirus briefly
 * locks freshly written executables, so EPERM/EBUSY are retried there.
 */
function moveIntoPlace(stage, dep) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(stage, dep.dir);
      return;
    } catch (err) {
      if (isInstalled(dep.dir, dep.entry)) {
        // A concurrent setup won the race; its install is just as verified.
        return;
      }
      const transient =
        process.platform === 'win32' &&
        (err.code === 'EPERM' || err.code === 'EBUSY');
      if (!transient || attempt >= 5) {
        throw new ToolFailure(
          `Could not move ${dep.name} into ${dep.dir}: ${err.message}. ` +
            `Check that the directory is writable, then run setup again.`,
          'DEPS_INSTALL_FAILED'
        );
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

/** Removes temporary directories a killed setup left behind. */
function sweepStale(parent) {
  for (const name of fs.readdirSync(parent)) {
    if (!name.startsWith('.tmp-')) continue;
    const full = path.join(parent, name);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs > STALE_TMP_MS) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch (err) {
      log('warn', `Could not remove stale ${full}: ${err.message}`);
    }
  }
}

/** Streams `entry.url` to `dest`, hashing on the way; rejects a mismatch. */
async function downloadVerified(entry, dest, label) {
  const controller = new AbortController();
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error(`no data for ${STALL_MS / 1000}s`)),
      STALL_MS
    );
  };
  const failed = (detail) =>
    new ToolFailure(
      `Could not download ${label} from ${entry.url}: ${detail}. Check the ` +
        `network connection (behind a proxy, set NODE_USE_ENV_PROXY=1 on ` +
        `Node 22.21+) and run setup again.`,
      'DEPS_DOWNLOAD_FAILED'
    );

  arm();
  try {
    let res;
    try {
      res = await fetch(entry.url, { signal: controller.signal });
    } catch (err) {
      throw failed(describeError(err));
    }
    if (!res.ok || !res.body) {
      throw res.status === 404
        ? new ToolFailure(
            `${label} is gone from ${entry.url} (HTTP 404). The pinned ` +
              `release was removed upstream — bump the pin in deps.json ` +
              `(README -> Updating the pins).`,
            'DEPS_DOWNLOAD_FAILED'
          )
        : failed(`HTTP ${res.status}`);
    }

    const total = Number(res.headers.get('content-length')) || undefined;
    log(
      'info',
      `Downloading ${label}${total ? ` (${formatBytes(total)})` : ''}`
    );
    const hash = crypto.createHash('sha256');
    const progress = createProgressReporter(`Downloading ${label}`);
    let received = 0;
    const tap = new Transform({
      transform(chunk, _enc, done) {
        arm();
        hash.update(chunk);
        received += chunk.length;
        if (total) progress.update(received, total);
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(res.body),
        tap,
        fs.createWriteStream(dest)
      );
    } catch (err) {
      throw failed(describeError(err));
    }

    const actual = hash.digest('hex');
    if (actual !== entry.sha256) {
      throw new ToolFailure(
        `Checksum mismatch for ${label}: expected ${entry.sha256}, got ` +
          `${actual}. Nothing was installed. Either the pin in deps.json is ` +
          `wrong or the download was altered — do not use this file.`,
        'DEPS_CHECKSUM_MISMATCH',
        false
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

function describeError(err) {
  const cause = err && err.cause ? `: ${err.cause.message || err.cause}` : '';
  return `${err && err.message ? err.message : err}${cause}`;
}

/**
 * Extracts `members` with the system tar: bsdtar on Windows 10+ (System32,
 * which reads zip), GNU tar or bsdtar elsewhere (xz via the xz tool). The
 * System32 path is explicit because Git for Windows puts a GNU tar, which
 * cannot read zip, earlier on PATH.
 */
function extract(archive, destDir, members, label) {
  let tar = 'tar';
  if (process.platform === 'win32') {
    if (!process.env.SystemRoot) {
      throw new ToolFailure(
        `Cannot extract ${label}: SystemRoot is not set, so System32\\tar.exe ` +
          `cannot be located. Run mctl from a normal Windows shell.`,
        'DEPS_EXTRACT_FAILED'
      );
    }
    tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe');
  }
  const r = spawnSync(tar, ['-xf', archive, '-C', destDir, ...members], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.error || r.status !== 0) {
    const detail = r.error ? r.error.message : r.stderr.trim();
    throw new ToolFailure(
      `Could not extract ${label} with ${tar}: ${detail}. On Linux, install ` +
        `the tar and xz packages; then run setup again.`,
      'DEPS_EXTRACT_FAILED'
    );
  }
}

module.exports = {
  DEPS_FILE_ENV,
  depsDir,
  loadDeps,
  platformKey,
  resolveBinaries,
  setup,
};
