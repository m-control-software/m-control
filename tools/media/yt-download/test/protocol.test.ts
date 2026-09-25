import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expectProtocol,
  expectRecoverableError,
  readManifest,
  runTool,
} from '@m-control/test-support';

/**
 * Input rules and the download path. yt-dlp is replaced by
 * test/fixtures/fake-yt-dlp.js, HOME points into a temp dir, and nothing
 * touches the network. The fake is a shebang script, which Windows cannot
 * spawn directly, so the download suites run on POSIX only (CI is Ubuntu).
 */

const TOOL_DIR = path.resolve(__dirname, '..');
const FAKE_YTDLP = path.join(__dirname, 'fixtures', 'fake-yt-dlp.js');
const { id } = readManifest(TOOL_DIR);
const POSIX = process.platform !== 'win32';

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-download-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function run(
  input: Record<string, string>,
  config: Record<string, unknown> = {},
  env: Record<string, string> = {}
) {
  return runTool(TOOL_DIR, {
    config,
    input,
    workspaceRoot: sandbox,
    env: { ...process.env, HOME: sandbox, USERPROFILE: sandbox, ...env },
  });
}

/** Config that points both binaries at test doubles inside the sandbox. */
function fakeConfig(): Record<string, unknown> {
  const ffmpegDir = path.join(sandbox, 'ffmpeg');
  fs.mkdirSync(ffmpegDir, { recursive: true });
  return {
    'yt-download.ytDlpPath': FAKE_YTDLP,
    'yt-download.ffmpegPath': ffmpegDir,
    'yt-download.outputDir': path.join(sandbox, 'out'),
  };
}

describe(`${id} input`, () => {
  it.each([
    [{}, 'url is required'],
    [{ url: 'not a url' }, 'is not a URL'],
    [{ url: 'file:///etc/passwd' }, 'http(s)'],
    [{ url: 'https://youtu.be/x', format: 'flac' }, 'format=flac'],
    [{ url: 'https://youtu.be/x', playlist: 'yes' }, 'playlist=true'],
    [{ url: 'https://youtu.be/x', check: '1' }, 'check=true'],
    [{ url: 'https://youtu.be/x', maxHeight: 'hd' }, 'maxHeight=hd'],
    [{ url: 'https://youtu.be/x', maxHeight: '0' }, 'maxHeight=0'],
    [
      { url: 'https://youtu.be/x', format: 'audio', maxHeight: '720' },
      'format=video only',
    ],
    [{ url: 'https://youtu.be/x', fromat: 'audio' }, 'Unknown input'],
    [{ action: 'setup', url: 'https://youtu.be/x' }, 'Unknown input'],
    [{ action: 'upload' }, 'action=upload'],
  ])('rejects %j as INPUT_INVALID', (input, message) => {
    const r = run(input);
    expectRecoverableError(r, id);
    expect(r.error?.code).toBe('INPUT_INVALID');
    expect(String(r.error?.message)).toContain(message);
  });

  it('reports a malformed request as a non-recoverable error', () => {
    const r = runTool(TOOL_DIR, { stdin: 'not json' });
    expectProtocol(r, id);
    expect(r.error?.code).toBe('INVALID_REQUEST');
    expect(r.error?.recoverable).toBe(false);
  });
});

describe(`${id} dependency resolution`, () => {
  it('fails with DEPS_MISSING, naming setup, before anything is installed', () => {
    const r = run({ url: 'https://youtu.be/abcdefghijk' });
    expectRecoverableError(r, id);
    expect(r.error?.code).toBe('DEPS_MISSING');
    expect(String(r.error?.message)).toContain('action=setup');
  });

  it('fails with CONFIG_INVALID when a configured binary does not exist', () => {
    const r = run(
      { url: 'https://youtu.be/abcdefghijk' },
      { 'yt-download.ytDlpPath': path.join(sandbox, 'nope', 'yt-dlp') }
    );
    expectRecoverableError(r, id);
    expect(r.error?.code).toBe('CONFIG_INVALID');
    expect(String(r.error?.message)).toContain('tools.yt-download.ytDlpPath');
  });

  it('fails with CONFIG_INVALID when a path key is not a string', () => {
    const r = run(
      { url: 'https://youtu.be/abcdefghijk' },
      { 'yt-download.outputDir': 42 }
    );
    expectRecoverableError(r, id);
    expect(r.error?.code).toBe('CONFIG_INVALID');
  });
});

describe.skipIf(!POSIX)(`${id} download (fake yt-dlp)`, () => {
  function download(
    input: Record<string, string>,
    scenario: string,
    config = fakeConfig()
  ) {
    const argsFile = path.join(sandbox, 'args.json');
    const r = run({ url: 'https://youtu.be/abcdefghijk', ...input }, config, {
      FAKE_YTDLP_SCENARIO: scenario,
      FAKE_YTDLP_ARGS: argsFile,
    });
    const args: string[] = fs.existsSync(argsFile)
      ? JSON.parse(fs.readFileSync(argsFile, 'utf-8'))
      : [];
    return { r, args };
  }

  it('downloads a video and reports the saved file, with a non-ASCII title intact', () => {
    const { r, args } = download({}, 'ok');
    expectProtocol(r, id);
    const items = r.result?.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'abcdefghijk',
      title: 'Zażółć gęślą jaźń',
      bytes: 1000,
      durationSec: 42,
    });
    expect(fs.existsSync(String(items[0].file))).toBe(true);
    expect(r.result).toMatchObject({
      format: 'video',
      failed: [],
      outputDir: path.join(sandbox, 'out'),
      ytDlp: { version: '2099.01.01', source: 'config' },
    });

    // Deterministic invocation: no user config, Node as the JS runtime,
    // mp4 merge, no overwrites, and the URL after `--`.
    expect(args).toContain('--ignore-config');
    expect(args).toContain('--no-overwrites');
    expect(args).toContain('--no-playlist');
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe(
      `node:${process.execPath}`
    );
    expect(args[args.indexOf('--merge-output-format') + 1]).toBe('mp4');
    expect(args.slice(-2)).toEqual(['--', 'https://youtu.be/abcdefghijk']);
  });

  it('uses the managed install of the pinned versions when nothing is configured', () => {
    const platform = `${process.platform}-${process.arch}`;
    const depsFile = path.join(sandbox, 'deps.json');
    const pin = { url: 'https://example.invalid/x', sha256: '0'.repeat(64) };
    fs.writeFileSync(
      depsFile,
      JSON.stringify({
        'yt-dlp': {
          version: '1.0',
          platforms: { [platform]: { ...pin, file: 'yt-dlp' } },
        },
        ffmpeg: {
          version: '2.0',
          platforms: {
            [platform]: {
              ...pin,
              archive: 'tar.xz',
              binDir: 'x/bin',
              files: ['ffmpeg', 'ffprobe'],
            },
          },
        },
      })
    );
    const root = path.join(sandbox, '.m-control', 'deps');
    fs.mkdirSync(path.join(root, 'yt-dlp', '1.0'), { recursive: true });
    fs.copyFileSync(FAKE_YTDLP, path.join(root, 'yt-dlp', '1.0', 'yt-dlp'));
    fs.chmodSync(path.join(root, 'yt-dlp', '1.0', 'yt-dlp'), 0o755);
    fs.mkdirSync(path.join(root, 'ffmpeg', '2.0'), { recursive: true });
    for (const f of ['ffmpeg', 'ffprobe']) {
      fs.writeFileSync(path.join(root, 'ffmpeg', '2.0', f), '');
    }

    const argsFile = path.join(sandbox, 'args.json');
    const r = run(
      { url: 'https://youtu.be/abcdefghijk' },
      {},
      {
        M_CONTROL_YT_DOWNLOAD_DEPS: depsFile,
        FAKE_YTDLP_SCENARIO: 'ok',
        FAKE_YTDLP_ARGS: argsFile,
      }
    );
    expectProtocol(r, id);
    expect(r.result).toMatchObject({
      ytDlp: { version: '1.0', source: 'managed' },
      // Default output directory: ~/Downloads.
      outputDir: path.join(sandbox, 'Downloads'),
    });
    const args: string[] = JSON.parse(fs.readFileSync(argsFile, 'utf-8'));
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe(
      path.join(root, 'ffmpeg', '2.0')
    );
  });

  it('throttles progress to at most one log per 10 % step', () => {
    const { r } = download({}, 'ok');
    const progress = r.events.filter(
      (e) => e.type === 'log' && /%/.test(String(e.payload.message))
    );
    // 5 progress lines within milliseconds: only the first step is logged.
    expect(progress.length).toBeLessThanOrEqual(1);
  });

  it('builds mp3 extraction arguments for format=audio', () => {
    const { r, args } = download({ format: 'audio' }, 'ok');
    expectProtocol(r, id);
    expect(args).toContain('--extract-audio');
    expect(args[args.indexOf('--audio-format') + 1]).toBe('mp3');
    expect(args).toContain('--embed-thumbnail');
    const items = r.result?.items as Array<Record<string, unknown>>;
    expect(String(items[0].file)).toMatch(/\.mp3$/);
  });

  it('caps the resolution with maxHeight and passes playlist=true', () => {
    const { args } = download({ maxHeight: '720', playlist: 'true' }, 'ok');
    expect(args[args.indexOf('-S') + 1]).toBe('res:720,vcodec:h264,acodec:m4a');
    expect(args).toContain('--yes-playlist');
  });

  it('resolves a relative outDir against the workspace root', () => {
    const { r } = download({ outDir: 'here' }, 'ok');
    expectProtocol(r, id);
    expect(r.result?.outputDir).toBe(path.join(sandbox, 'here'));
  });

  it('check=true reports what would be downloaded and writes nothing', () => {
    const { r, args } = download({ check: 'true' }, 'ok');
    expectProtocol(r, id);
    expect(args).toContain('--simulate');
    expect(r.result).toMatchObject({
      check: true,
      items: [{ id: 'abcdefghijk', title: 'Zażółć gęślą jaźń' }],
    });
    expect(fs.existsSync(path.join(sandbox, 'out'))).toBe(false);
  });

  it('returns a result listing the failures when part of a playlist fails', () => {
    const { r } = download({ playlist: 'true' }, 'partial');
    expectProtocol(r, id);
    expect(r.result?.items).toHaveLength(1);
    expect(r.result?.failed).toEqual([
      expect.objectContaining({
        id: 'zzzzzzzzzzz',
        code: 'VIDEO_UNAVAILABLE',
        recoverable: true,
      }),
    ]);
  });

  it.each([
    ['unavailable', 'VIDEO_UNAVAILABLE', true],
    ['extraction', 'EXTRACTION_FAILED', true],
    ['crash', 'YTDLP_FAILED', false],
  ])('maps yt-dlp scenario %s to %s', (scenario, code, recoverable) => {
    const { r } = download({}, scenario);
    expectProtocol(r, id);
    expect(r.error?.code).toBe(code);
    expect(r.error?.recoverable).toBe(recoverable);
  });

  it('forwards yt-dlp output to stderr, never to stdout', () => {
    const { r } = download({}, 'ok');
    expect(r.stderr).toContain('[youtube] Extracting URL');
    // runTool already fails on any non-JSON stdout line.
    expectProtocol(r, id);
  });

  it('fails with OUTPUT_DIR_UNWRITABLE when outDir cannot be created', () => {
    const blocker = path.join(sandbox, 'file');
    fs.writeFileSync(blocker, '');
    const { r } = download({ outDir: path.join(blocker, 'sub') }, 'ok');
    expectRecoverableError(r, id);
    expect(r.error?.code).toBe('OUTPUT_DIR_UNWRITABLE');
  });
});
