import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  expectProtocol,
  runTool,
  runtimeAvailable,
} from '@m-control/test-support';

/** hello-python is the python protocol reference: it must stay conformant. */

const TOOL_DIR = path.resolve(__dirname, '..');

describe.skipIf(!runtimeAvailable(TOOL_DIR))('hello-python', () => {
  it('greets the name from input', () => {
    const r = runTool(TOOL_DIR, { input: { name: 'CI' } });
    expectProtocol(r, 'hello-python');
    expect(r.result?.message).toBe('Hello, CI!');
  });

  it('defaults to World', () => {
    const r = runTool(TOOL_DIR);
    expectProtocol(r, 'hello-python');
    expect(r.result?.message).toBe('Hello, World!');
  });
});
