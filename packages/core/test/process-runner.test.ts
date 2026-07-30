import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProcessRunner,
  resolveSpawnCommand,
} from '../src/runner/process-runner';
import { ResolvedTool, RunContext, ToolEvent } from '../src/types';

const isWindows = process.platform === 'win32';

describe('resolveSpawnCommand', () => {
  it('runs node tools with the current Node binary', () => {
    expect(resolveSpawnCommand('node', '/t/index.js')).toEqual({
      command: process.execPath,
      args: ['/t/index.js'],
    });
  });

  it('picks the platform default python interpreter', () => {
    const { command } = resolveSpawnCommand('python', '/t/main.py');
    expect(command).toBe(isWindows ? 'python' : 'python3');
  });

  it('honors config overrides', () => {
    expect(
      resolveSpawnCommand('python', '/t/main.py', { python: 'py' })
    ).toEqual({ command: 'py', args: ['/t/main.py'] });
  });

  it('passes powershell scripts via -File with safe flags', () => {
    const { command, args } = resolveSpawnCommand('powershell', '/t/run.ps1');
    expect(command).toBe(isWindows ? 'powershell' : 'pwsh');
    expect(args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-File',
      '/t/run.ps1',
    ]);
  });

  it('uses the dotnet host for .dll entries and direct spawn for executables', () => {
    expect(resolveSpawnCommand('dotnet', '/t/Tool.dll')).toEqual({
      command: 'dotnet',
      args: ['/t/Tool.dll'],
    });
    expect(resolveSpawnCommand('dotnet', '/t/Tool.exe')).toEqual({
      command: '/t/Tool.exe',
      args: [],
    });
  });
});

describe('ProcessRunner (integration, node runtime)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mctl-runner-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeTool(id: string, script: string): ResolvedTool {
    const entryPath = path.join(dir, 'index.js');
    fs.writeFileSync(entryPath, script);
    return {
      manifest: {
        manifestVersion: 1,
        id,
        version: '0.1.0',
        name: id,
        description: 'test tool',
        runtime: 'node',
        entry: 'index.js',
      },
      dir,
      entryPath,
    };
  }

  const context: RunContext = {
    toolId: 'echo-tool',
    config: { 'svc.key': 'value' },
    workspaceRoot: '/workspace',
  };

  async function collect(
    events: AsyncIterable<ToolEvent>
  ): Promise<ToolEvent[]> {
    const out: ToolEvent[] = [];
    for await (const e of events) out.push(e);
    return out;
  }

  it('streams events from a protocol-compliant tool', async () => {
    const tool = makeTool(
      'echo-tool',
      `
      const chunks = [];
      process.stdin.on('data', (c) => chunks.push(c));
      process.stdin.on('end', () => {
        const req = JSON.parse(Buffer.concat(chunks).toString());
        const emit = (type, payload) => process.stdout.write(
          JSON.stringify({ type, ts: new Date().toISOString(), toolId: 'echo-tool', payload }) + '\\n'
        );
        emit('started', { meta: {} });
        emit('result', { echoed: req.input, cfg: req.context.config });
        process.exit(0);
      });
      `
    );

    const events = await collect(
      new ProcessRunner().run(tool, context, { hello: 'world' })
    );

    expect(events.map((e) => e.type)).toEqual(['started', 'result']);
    const result = events[1] as Extract<ToolEvent, { type: 'result' }>;
    expect(result.payload).toEqual({
      echoed: { hello: 'world' },
      cfg: { 'svc.key': 'value' },
    });
  });

  it('emits a synthetic error event when the tool crashes', async () => {
    const tool = makeTool('echo-tool', `process.exit(3);`);

    const events = await collect(new ProcessRunner().run(tool, context, {}));
    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    expect((error!.payload as { code: string }).code).toBe('TOOL_CRASH');
  });

  it('enforces the timeout guardrail', async () => {
    const tool = makeTool(
      'echo-tool',
      `setTimeout(() => process.exit(0), 60000);`
    );

    const events = await collect(
      new ProcessRunner().run(tool, context, {}, { timeoutMs: 300 })
    );
    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    expect((error!.payload as { code: string }).code).toBe('RUNNER_TIMEOUT');
  }, 10_000);

  it('throws RunnerError when the runtime command does not exist', async () => {
    const tool = makeTool('echo-tool', '');

    await expect(
      collect(
        new ProcessRunner({ node: 'definitely-not-a-real-binary' }).run(
          tool,
          context,
          {}
        )
      )
    ).rejects.toThrow(/Process error/);
  });
});
