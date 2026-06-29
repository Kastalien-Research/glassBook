import { describe, it, expect } from 'vitest';
import { makeGlassbookCell } from './cell.mjs';

describe('makeGlassbookCell', () => {
  it('builds a typed input-processing-output cell with gates', () => {
    const cell = makeGlassbookCell({
      section: 'workExecution',
      input: { prompt: 'fix the test' },
      processing: { behavior: 'create missing file' },
      output: { achieved: true },
      gates: [{ id: 'tests', description: 'tests pass', command: 'npm test' }],
    });

    expect(cell.section).toBe('workExecution');
    expect(cell.input.prompt).toBe('fix the test');
    expect(cell.processing.behavior).toBe('create missing file');
    expect(cell.output.achieved).toBe(true);
    expect(cell.gates).toHaveLength(1);
  });
});
