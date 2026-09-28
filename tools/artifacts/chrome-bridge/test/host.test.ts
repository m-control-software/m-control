import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The native messaging host and its allowlist, on every platform: framing,
 * URL rules, and the host end to end with a fake mctl (fixtures/fake-mctl.js)
 * that records the argv it was given. Nothing here starts Chrome or mctl.
 */

const TOOL_DIR = path.resolve(__dirname, '..');
/* eslint-disable @typescript-eslint/no-require-imports -- the tool is plain CommonJS by design */
const native = require(path.join(TOOL_DIR, 'host', 'native.js'));
const actions = require(path.join(TOOL_DIR, 'extension', 'actions.js'));
const host = require(path.join(TOOL_DIR, 'host', 'host.js'));
const install = require(path.join(TOOL_DIR, 'lib', 'install.js'));
/* eslint-enable @typescript-eslint/no-require-imports */

const ID = 'dQw4w9WgXcQ';

describe('native messaging framing', () => {
  it('round-trips messages split across chunks, with a little-endian length', () => {
    const a = native.encode({ action: 'yt-audio', url: 'https://youtu.be/x' });
    const b = native.encode({ n: 'zażółć →' });
    expect(a.readUInt32LE(0)).toBe(a.length - 4);
    const d = native.createDecoder();
    const all = Buffer.concat([a, b]);
    expect(d.push(all.subarray(0, 3))).toEqual([]);
    expect(d.push(all.subarray(3, a.length + 5))).toEqual([
      { action: 'yt-audio', url: 'https://youtu.be/x' },
    ]);
    expect(d.push(all.subarray(a.length + 5))).toEqual([{ n: 'zażółć →' }]);
    expect(d.pending()).toBe(0);
  });

  it('refuses messages above 1 MB both ways, and bodies that are not JSON', () => {
    expect(() =>
      native.encode({ s: 'x'.repeat(native.MAX_MESSAGE_BYTES) })
    ).toThrow(/exceeds/);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(native.MAX_MESSAGE_BYTES + 1, 0);
    expect(() => native.createDecoder().push(header)).toThrow(/exceeds/);
    const bad = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.from('{x}')]);
    expect(() => native.createDecoder().push(bad)).toThrow(/not JSON/);
  });
});

describe('allowlist and URL rules', () => {
  const ok: Array<[string, string]> = [
    [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/watch?v=${ID}`,
    ],
    [
      `https://youtube.com/watch?v=${ID}&t=42s`,
      `https://www.youtube.com/watch?v=${ID}`,
    ],
    [
      `https://m.youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/watch?v=${ID}`,
    ],
    [`https://youtu.be/${ID}?si=abc`, `https://www.youtube.com/watch?v=${ID}`],
    [
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/watch?v=${ID}`,
    ],
    [
      `https://music.youtube.com/watch?v=${ID}&list=RDAMVM${ID}`,
      `https://music.youtube.com/watch?v=${ID}`,
    ],
    [
      `https://www.youtube.com/watch?v=${ID}&list=PL1234567890&index=3`,
      `https://www.youtube.com/watch?v=${ID}`,
    ],
  ];
  it.each(ok)('accepts %s as a single track', (url, canonical) => {
    expect(actions.youtubeVideo(url)).toBe(canonical);
  });

  const refused: Array<[string, string]> = [
    [`https://youtube.com.evil.example/watch?v=${ID}`, 'URL_NOT_ALLOWED'],
    [`https://evilyoutube.com/watch?v=${ID}`, 'URL_NOT_ALLOWED'],
    [`https://www.youtube.com@evil.example/watch?v=${ID}`, 'URL_NOT_ALLOWED'],
    [`https://user:pw@www.youtube.com/watch?v=${ID}`, 'URL_NOT_ALLOWED'],
    [`https://www.youtube.com:8443/watch?v=${ID}`, 'URL_NOT_ALLOWED'],
    ['javascript:alert(document.domain)//youtube.com', 'URL_NOT_ALLOWED'],
    [`file:///C:/youtube.com/watch?v=${ID}`, 'URL_NOT_ALLOWED'],
    ['https://www.google.com/search?q=youtube', 'URL_NOT_ALLOWED'],
    ['https://www.youtube.com/playlist?list=PL1234567890', 'NOT_A_VIDEO'],
    ['https://www.youtube.com/@channel', 'NOT_A_VIDEO'],
    ['https://www.youtube.com/watch?v=short', 'NOT_A_VIDEO'],
    [`https://www.youtube.com/watch?v=${ID}%22%20--exec`, 'NOT_A_VIDEO'],
    ['chrome://extensions', 'URL_NOT_ALLOWED'],
    ['not a url', 'URL_INVALID'],
  ];
  it.each(refused)('refuses %s (%s)', (url, code) => {
    expect(() => actions.youtubeVideo(url)).toThrow(
      expect.objectContaining({ code })
    );
  });

  it('knows exactly one action, and builds its whole argument list', () => {
    expect(Object.keys(actions.ACTIONS)).toEqual(['yt-audio']);
    expect(
      actions.resolve({ action: 'yt-audio', url: `https://youtu.be/${ID}` })
        .args
    ).toEqual([
      'run',
      'yt-download',
      `url=https://www.youtube.com/watch?v=${ID}`,
      'format=audio',
      '--json',
    ]);
    for (const action of [
      'run',
      'toString',
      '__proto__',
      'yt-video',
      undefined,
    ]) {
      expect(() =>
        actions.resolve({ action, url: `https://youtu.be/${ID}` })
      ).toThrow(expect.objectContaining({ code: 'ACTION_NOT_ALLOWED' }));
    }
  });

  it('pins the extension id the host accepts to the key in the extension manifest', () => {
    const ext = JSON.parse(
      fs.readFileSync(
        path.join(TOOL_DIR, 'extension', 'manifest.json'),
        'utf-8'
      )
    );
    expect(install.extensionId(ext.key)).toBe(host.EXTENSION_ID);
    expect(ext.commands['yt-audio'].suggested_key.default).toBe('Ctrl+Shift+Y');
    // The public key only: a private key would be PEM text, not bare base64 DER.
    expect(ext.key).toMatch(/^MIIBIjAN[A-Za-z0-9+/=]+$/);
  });
});

describe('host with a fake mctl', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-bridge-host-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  interface HostRun {
    status: number | null;
    messages: Array<Record<string, unknown>>;
    argv: string[] | undefined;
    log: string;
  }

  function runHost(
    message: unknown,
    opts: {
      origin?: string;
      mctl?: string;
      env?: NodeJS.ProcessEnv;
      raw?: Buffer;
    } = {}
  ): Promise<HostRun> {
    const argsFile = path.join(dir, 'argv.json');
    const logFile = path.join(dir, 'host.log');
    const child = spawn(
      process.execPath,
      [
        path.join(TOOL_DIR, 'host', 'host.js'),
        '--mctl',
        opts.mctl ?? path.join(__dirname, 'fixtures', 'fake-mctl.js'),
        '--log',
        logFile,
        opts.origin ?? host.ORIGIN,
        '--parent-window=0',
      ],
      { env: { ...process.env, FAKE_MCTL_ARGS: argsFile, ...opts.env } }
    );
    const out: Buffer[] = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stdin.write(opts.raw ?? native.encode(message));
    return new Promise((resolve) => {
      child.on('close', (status) => {
        const decoder = native.createDecoder();
        resolve({
          status,
          messages: decoder.push(Buffer.concat(out)),
          argv: fs.existsSync(argsFile)
            ? JSON.parse(fs.readFileSync(argsFile, 'utf-8'))
            : undefined,
          log: fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '',
        });
      });
    });
  }

  it('runs the one allowlisted command and relays its events', async () => {
    const run = await runHost({
      action: 'yt-audio',
      url: `https://music.youtube.com/watch?v=${ID}&list=RDAMVM${ID}`,
    });
    expect(run.argv).toEqual([
      'run',
      'yt-download',
      `url=https://music.youtube.com/watch?v=${ID}`,
      'format=audio',
      '--json',
    ]);
    const types = run.messages.map((m) =>
      m.type === 'event'
        ? `event:${(m.event as { type: string }).type}`
        : m.type
    );
    expect(types).toEqual([
      'accepted',
      'event:started',
      'event:log',
      'event:result',
      'done',
    ]);
    expect(run.messages.at(-1)).toEqual({ type: 'done', exitCode: 0 });
    expect(run.status).toBe(0);
  }, 30_000);

  it('relays a failed download with its code', async () => {
    const run = await runHost(
      { action: 'yt-audio', url: `https://youtu.be/${ID}` },
      { env: { FAKE_MCTL_EXIT: '1' } }
    );
    const error = run.messages.find(
      (m) =>
        m.type === 'event' && (m.event as { type: string }).type === 'error'
    );
    expect((error!.event as { payload: { code: string } }).payload.code).toBe(
      'VIDEO_UNAVAILABLE'
    );
    expect(run.messages.at(-1)).toEqual({ type: 'done', exitCode: 1 });
  }, 30_000);

  it.each([
    [{ action: 'yt-audio', url: 'https://example.com/' }, 'URL_NOT_ALLOWED'],
    [{ action: 'yt-audio', url: 'javascript:alert(1)' }, 'URL_NOT_ALLOWED'],
    [{ action: 'shell', url: `https://youtu.be/${ID}` }, 'ACTION_NOT_ALLOWED'],
    ['just a string', 'MESSAGE_INVALID'],
  ])(
    'rejects %j without spawning anything',
    async (message, code) => {
      const run = await runHost(message);
      expect(run.messages).toEqual([
        expect.objectContaining({ type: 'rejected', code }),
      ]);
      expect(run.argv).toBeUndefined();
      expect(run.status).toBe(1);
    },
    30_000
  );

  it('rejects an oversized message without spawning anything', async () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(native.MAX_MESSAGE_BYTES + 1, 0);
    const run = await runHost(undefined, { raw: header });
    expect(run.messages).toEqual([
      expect.objectContaining({ type: 'rejected', code: 'MESSAGE_INVALID' }),
    ]);
    expect(run.argv).toBeUndefined();
  }, 30_000);

  it('talks to no one but its own extension', async () => {
    const run = await runHost(
      { action: 'yt-audio', url: `https://youtu.be/${ID}` },
      { origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' }
    );
    expect(run.messages).toEqual([]);
    expect(run.argv).toBeUndefined();
    expect(run.status).toBe(1);
    expect(run.log).toContain('refused caller');
  }, 30_000);

  const lockFor = (url: string) =>
    path.join(
      dir,
      'running',
      crypto.createHash('sha256').update(url).digest('hex').slice(0, 16) +
        '.lock'
    );

  it('refuses a second job for a track that is still downloading', async () => {
    const canonical = `https://www.youtube.com/watch?v=${ID}`;
    fs.mkdirSync(path.join(dir, 'running'));
    fs.writeFileSync(lockFor(canonical), String(process.pid)); // a live holder
    const run = await runHost({
      action: 'yt-audio',
      url: `https://youtu.be/${ID}`,
    });
    expect(run.messages).toEqual([
      expect.objectContaining({ type: 'rejected', code: 'ALREADY_RUNNING' }),
    ]);
    expect(run.argv).toBeUndefined();
  }, 30_000);

  it('takes over a stale lock and releases it when done', async () => {
    const canonical = `https://www.youtube.com/watch?v=${ID}`;
    fs.mkdirSync(path.join(dir, 'running'));
    fs.writeFileSync(lockFor(canonical), '999999999'); // its host is gone
    const run = await runHost({ action: 'yt-audio', url: canonical });
    expect(run.messages.at(-1)).toEqual({ type: 'done', exitCode: 0 });
    expect(fs.existsSync(lockFor(canonical))).toBe(false);
  }, 30_000);

  it('says where mctl was expected when it is missing', async () => {
    const run = await runHost(
      { action: 'yt-audio', url: `https://youtu.be/${ID}` },
      { mctl: path.join(dir, 'no-mctl.js') }
    );
    expect(run.messages).toEqual([
      expect.objectContaining({ type: 'rejected', code: 'MCTL_NOT_FOUND' }),
    ]);
  }, 30_000);

  it('keeps the download running when the port closes', async () => {
    const argsFile = path.join(dir, 'argv.json');
    const done = path.join(dir, 'done.txt');
    const child = spawn(
      process.execPath,
      [
        path.join(TOOL_DIR, 'host', 'host.js'),
        '--mctl',
        path.join(__dirname, 'fixtures', 'fake-mctl.js'),
        '--log',
        done,
        host.ORIGIN,
      ],
      {
        env: {
          ...process.env,
          FAKE_MCTL_ARGS: argsFile,
          FAKE_MCTL_DELAY_MS: '1500',
        },
      }
    );
    child.stdin.end(
      native.encode({ action: 'yt-audio', url: `https://youtu.be/${ID}` })
    );
    child.stdout.destroy(); // the browser side is gone
    await new Promise((r) => child.on('close', r));
    const log = fs.readFileSync(done, 'utf-8');
    expect(log).toContain('port closed; the download continues');
    expect(log).toContain('mctl exited with 0');
  }, 30_000);
});

describe('install plan', () => {
  const want = () =>
    install.desired({
      toolDir: TOOL_DIR,
      stateDir: path.join(
        path.sep,
        'home',
        'me',
        '.m-control',
        'chrome-bridge'
      ),
      nodePath: path.join(path.sep, 'node', 'node.exe'),
      mctlPath: path.join(path.sep, 'home', 'me', '.m-control', 'mctl.js'),
    });

  it('writes a host manifest that only our extension may use, with absolute paths', () => {
    const w = want();
    const hostManifest = JSON.parse(w.files[0].content);
    expect(hostManifest).toMatchObject({
      name: 'com.m_control.chrome_bridge',
      type: 'stdio',
      allowed_origins: [host.ORIGIN],
    });
    expect(path.isAbsolute(hostManifest.path)).toBe(true);
    expect(w.files[1].content).toContain(
      `"${path.join(TOOL_DIR, 'host', 'host.js')}" --mctl`
    );
    expect(w.files[1].content).toMatch(/\r\n/);
    expect(w.registry.value).toBe(w.files[0].path);
  });

  it('plans create, then nothing, then removal', () => {
    const w = want();
    const none = { files: {}, registry: undefined };
    expect(
      install.plan('install', w, none).map((c: { action: string }) => c.action)
    ).toEqual(['create', 'create', 'create']);
    const installed = {
      files: Object.fromEntries(
        w.files.map((f: { path: string; content: string }) => [
          f.path,
          f.content,
        ])
      ),
      registry: w.registry.value,
    };
    expect(
      install
        .plan('install', w, installed)
        .map((c: { action: string }) => c.action)
    ).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(
      install
        .plan('uninstall', w, installed)
        .map((c: { action: string }) => c.action)
    ).toEqual(['remove', 'remove', 'absent', 'remove']);
    const stale = { ...installed, registry: 'C:\\old\\manifest.json' };
    expect(install.plan('install', w, stale).at(-1).action).toBe('update');
  });

  it('refuses a path the .cmd launcher cannot quote', () => {
    expect(() =>
      install.desired({
        ...{ toolDir: TOOL_DIR, stateDir: '/x', nodePath: '/n' },
        mctlPath: '/100%/mctl.js',
      })
    ).toThrow(expect.objectContaining({ code: 'PATH_UNSUPPORTED' }));
  });
});
