import { ChildProcess, spawn, spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  expectProtocol,
  expectRecoverableError,
  readManifest,
  runTool,
} from '@m-control/test-support';

/**
 * action=setup against a local HTTP server (test/fixtures/static-server.js)
 * serving generated assets, with deps.json swapped for a generated one via
 * M_CONTROL_YT_DOWNLOAD_DEPS. Nothing leaves the machine.
 */

const TOOL_DIR = path.resolve(__dirname, '..');
const { id } = readManifest(TOOL_DIR);
const PLATFORM = `${process.platform}-${process.arch}`;
const EXE = process.platform === 'win32' ? '.exe' : '';

let assets: string;
let server: ChildProcess;
let baseUrl: string;
let sandbox: string;

const sha256 = (file: string) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

beforeAll(async () => {
  assets = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-download-assets-'));
  fs.writeFileSync(path.join(assets, 'yt-dlp-bin'), '#!/bin/sh\necho fake\n');

  // An ffmpeg-shaped archive: <name>/bin/{ffmpeg,ffprobe} plus a file that
  // must not be installed.
  if (process.platform !== 'win32') {
    const bin = path.join(assets, 'src', 'ffmpeg-test', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const f of ['ffmpeg', 'ffprobe', 'ffplay']) {
      fs.writeFileSync(path.join(bin, f), f);
    }
    const tar = spawnSync(
      'tar',
      [
        '-cJf',
        path.join(assets, 'ffmpeg.tar.xz'),
        '-C',
        path.join(assets, 'src'),
        'ffmpeg-test',
      ],
      { encoding: 'utf8' }
    );
    if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
  }

  server = spawn(process.execPath, [
    path.join(__dirname, 'fixtures', 'static-server.js'),
    assets,
  ]);
  const port = await new Promise<string>((resolve, reject) => {
    server.stdout!.once('data', (d) => resolve(String(d).trim()));
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.kill();
  fs.rmSync(assets, { recursive: true, force: true });
});

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-download-setup-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

interface Entry {
  url: string;
  sha256: string;
  file?: string;
  archive?: string;
  binDir?: string;
  files?: string[];
}

function ytDlpEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    url: `${baseUrl}/yt-dlp-bin`,
    sha256: sha256(path.join(assets, 'yt-dlp-bin')),
    file: `yt-dlp${EXE}`,
    ...overrides,
  };
}

function ffmpegEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    url: `${baseUrl}/ffmpeg.tar.xz`,
    sha256: sha256(path.join(assets, 'ffmpeg.tar.xz')),
    archive: 'tar.xz',
    binDir: 'ffmpeg-test/bin',
    files: ['ffmpeg', 'ffprobe'],
    ...overrides,
  };
}

/** Writes a deps.json pinning the given entries for this platform. */
function pins(ytDlp?: Entry, ffmpeg?: Entry): string {
  const file = path.join(sandbox, 'deps.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      'yt-dlp': {
        version: '1.0',
        platforms: ytDlp ? { [PLATFORM]: ytDlp } : {},
      },
      ffmpeg: {
        version: '2.0',
        platforms: ffmpeg ? { [PLATFORM]: ffmpeg } : {},
      },
    })
  );
  return file;
}

function setup(
  depsFile: string,
  input: Record<string, string> = {},
  config: Record<string, unknown> = {}
) {
  return runTool(TOOL_DIR, {
    input: { action: 'setup', ...input },
    config,
    workspaceRoot: sandbox,
    env: {
      ...process.env,
      HOME: sandbox,
      USERPROFILE: sandbox,
      M_CONTROL_YT_DOWNLOAD_DEPS: depsFile,
    },
  });
}

const depsRoot = () => path.join(sandbox, '.m-control', 'deps');
/** Configures ffmpeg away so a test exercises the yt-dlp download only. */
const ownFfmpeg = () => ({ 'yt-download.ffmpegPath': sandbox });

describe(`${id} setup`, () => {
  it('installs a pinned binary once, then reports it as present', () => {
    const depsFile = pins(ytDlpEntry(), ffmpegEntry());
    const first = setup(depsFile, {}, ownFfmpeg());
    expectProtocol(first, id);
    expect(first.result).toMatchObject({
      platform: PLATFORM,
      installed: [{ name: 'yt-dlp', version: '1.0' }],
      alreadyPresent: [],
      skipped: [{ name: 'ffmpeg', reason: 'configured' }],
    });
    const installed = path.join(depsRoot(), 'yt-dlp', '1.0', `yt-dlp${EXE}`);
    expect(fs.readFileSync(installed, 'utf-8')).toContain('echo fake');
    if (process.platform !== 'win32') {
      expect(fs.statSync(installed).mode & 0o111).not.toBe(0);
    }
    const record = JSON.parse(
      fs.readFileSync(
        path.join(depsRoot(), 'yt-dlp', '1.0', 'install.json'),
        'utf-8'
      )
    );
    expect(record.sha256).toBe(ytDlpEntry().sha256);

    const second = setup(depsFile, {}, ownFfmpeg());
    expectProtocol(second, id);
    expect(second.result).toMatchObject({
      installed: [],
      alreadyPresent: [{ name: 'yt-dlp', version: '1.0' }],
    });
  });

  it.skipIf(process.platform === 'win32')(
    'extracts only the listed files from an archive',
    () => {
      const r = setup(pins(ytDlpEntry(), ffmpegEntry()));
      expectProtocol(r, id);
      expect(r.result?.installed).toHaveLength(2);
      const dir = path.join(depsRoot(), 'ffmpeg', '2.0');
      expect(fs.readdirSync(dir).sort()).toEqual([
        'ffmpeg',
        'ffprobe',
        'install.json',
      ]);
    }
  );

  it('check=true reports the plan and installs nothing', () => {
    const r = setup(pins(ytDlpEntry()), { check: 'true' }, ownFfmpeg());
    expectProtocol(r, id);
    expect(r.result).toMatchObject({
      check: true,
      toInstall: [{ name: 'yt-dlp', url: `${baseUrl}/yt-dlp-bin` }],
    });
    expect(fs.existsSync(depsRoot())).toBe(false);
  });

  it('rejects a checksum mismatch and leaves nothing behind', () => {
    const r = setup(
      pins(ytDlpEntry({ sha256: '0'.repeat(64) })),
      {},
      ownFfmpeg()
    );
    expectProtocol(r, id);
    expect(r.error?.code).toBe('DEPS_CHECKSUM_MISMATCH');
    expect(r.error?.recoverable).toBe(false);
    expect(fs.readdirSync(path.join(depsRoot(), 'yt-dlp'))).toEqual([]);
  });

  it('reports a missing release asset as DEPS_DOWNLOAD_FAILED', () => {
    const r = setup(
      pins(ytDlpEntry({ url: `${baseUrl}/gone` })),
      {},
      ownFfmpeg()
    );
    expectRecoverableError(r, id);
    expect(r.error?.code).toBe('DEPS_DOWNLOAD_FAILED');
    expect(String(r.error?.message)).toContain('HTTP 404');
  });

  it('reports an unreachable host as DEPS_DOWNLOAD_FAILED', () => {
    const r = setup(
      pins(ytDlpEntry({ url: 'http://127.0.0.1:1/yt-dlp-bin' })),
      {},
      ownFfmpeg()
    );
    expectRecoverableError(r, id);
    expect(r.error?.code).toBe('DEPS_DOWNLOAD_FAILED');
  });

  it('fails with UNSUPPORTED_PLATFORM when nothing is pinned for this platform', () => {
    const r = setup(pins(undefined, undefined));
    expectRecoverableError(r, id);
    expect(r.error?.code).toBe('UNSUPPORTED_PLATFORM');
    expect(String(r.error?.message)).toContain(PLATFORM);
  });

  it.skipIf(process.platform === 'win32')(
    'reports an archive whose layout does not match the pin as a bug',
    () => {
      const r = setup(pins(ytDlpEntry(), ffmpegEntry({ binDir: 'wrong/bin' })));
      expectProtocol(r, id);
      expect(r.error?.code).toMatch(/^DEPS_(MANIFEST_INVALID|EXTRACT_FAILED)$/);
      expect(fs.existsSync(path.join(depsRoot(), 'ffmpeg', '2.0'))).toBe(false);
    }
  );

  it('rejects a malformed pin file as DEPS_MANIFEST_INVALID', () => {
    const file = path.join(sandbox, 'deps.json');
    fs.writeFileSync(file, JSON.stringify({ 'yt-dlp': { version: '1' } }));
    const r = setup(file);
    expectProtocol(r, id);
    expect(r.error?.code).toBe('DEPS_MANIFEST_INVALID');
    expect(r.error?.recoverable).toBe(false);
  });
});

describe(`${id} deps.json`, () => {
  const deps = JSON.parse(
    fs.readFileSync(path.join(TOOL_DIR, 'deps.json'), 'utf-8')
  );

  it.each(['yt-dlp', 'ffmpeg'])(
    'pins %s for Windows and Linux on x64 and arm64',
    (name) => {
      const platforms = deps[name].platforms;
      expect(Object.keys(platforms).sort()).toEqual([
        'linux-arm64',
        'linux-x64',
        'win32-arm64',
        'win32-x64',
      ]);
      for (const entry of Object.values(platforms) as Entry[]) {
        expect(entry.url).toMatch(/^https:\/\/github\.com\/yt-dlp\//);
        // The pinned version is part of every URL, so a bump cannot leave a
        // platform on the old release.
        expect(entry.url).toContain(`/download/${deps[name].version}/`);
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  );
});
