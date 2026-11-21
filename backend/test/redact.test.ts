import { describe, expect, it } from 'vitest';
import { Redactor, redactGeneric } from '../src/redact';

const TOKEN = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GabcDe', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('.');
describe('log redaction', () => {
  it('removes Discord-token-shaped strings without knowing them', () => expect(redactGeneric(`login with ${TOKEN} ok`)).toBe('login with [REDACTED] ok'));
  it('removes known secrets, including in the middle of a line', () => expect(new Redactor(['hunter2-secret']).redact('pw=hunter2-secret;x')).toBe('pw=[REDACTED];x'));
  it('removes GitHub tokens', () => expect(redactGeneric('ghp_' + 'a'.repeat(30))).toBe('[REDACTED]'));
  it('ignores very short secrets to avoid mangling logs', () => expect(new Redactor(['abc']).redact('abc def')).toBe('abc def'));
});
