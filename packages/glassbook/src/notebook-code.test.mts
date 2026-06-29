import { describe, it, expect } from 'vitest';
import { gateCodeSource } from './notebook-code.mjs';

describe('gateCodeSource', () => {
  it('creates a rerunnable TypeScript gate cell', () => {
    const source = gateCodeSource({ repoDir: '/tmp/repo', command: 'npm test' });

    expect(source).toContain('const cwd = "/tmp/repo"');
    expect(source).toContain('const command = "npm test"');
    expect(source).toContain('execSync(command');
  });
});
