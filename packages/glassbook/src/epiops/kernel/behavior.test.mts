import { describe, it, expect } from 'vitest';
import { behaviorSignature, makeBehavior } from './behavior.mjs';

describe('behaviorSignature', () => {
  it('is stable for the same intent + evaluator', () => {
    const a = behaviorSignature('add a null check in parser', 'npm test passes');
    const b = behaviorSignature('add a null check in parser', 'npm test passes');
    expect(a).toBe(b);
  });

  it('ignores whitespace and case differences', () => {
    const a = behaviorSignature('Add a NULL check', 'NPM test');
    const b = behaviorSignature('  add   a null   check ', 'npm   test');
    expect(a).toBe(b);
  });

  it('differs for different behaviors', () => {
    const a = behaviorSignature('add a null check', 'npm test');
    const b = behaviorSignature('rewrite the parser', 'npm test');
    expect(a).not.toBe(b);
  });

  it('produces an 8-char hex string', () => {
    expect(behaviorSignature('x', 'y')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('makeBehavior', () => {
  it('attaches a signature derived from intent + evaluator', () => {
    const beh = makeBehavior({
      id: 't1p1',
      position: 1,
      intent: 'fix the off-by-one',
      evaluatorDescription: 'tests pass',
    });
    expect(beh.signature).toBe(behaviorSignature('fix the off-by-one', 'tests pass'));
    expect(beh.position).toBe(1);
  });
});
