import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { expectProtocol, runTool } from '@m-control/test-support';

/** hello-world is the node protocol reference: it must stay conformant. */

const TOOL_DIR = path.resolve(__dirname, '..');

describe('hello-world', () => {
  it('greets the name from input', () => {
    const r = runTool(TOOL_DIR, { input: { name: 'CI' } });
    expectProtocol(r, 'hello-world');
    expect(r.result?.message).toBe('Hello, CI!');
  });

  it('defaults to World', () => {
    const r = runTool(TOOL_DIR);
    expectProtocol(r, 'hello-world');
    expect(r.result?.message).toBe('Hello, World!');
  });
});
