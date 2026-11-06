import { describe, expect, it } from 'vitest';
import { hasSessionCookie } from './session-cookie';

describe('hasSessionCookie', () => {
  it('detecta o cookie de sessão, com ou sem __Secure-', () => {
    expect(hasSessionCookie('a=1; space-sports.session_token=abc; b=2')).toBe(true);
    expect(hasSessionCookie('__Secure-space-sports.session_token=abc')).toBe(true);
  });
  it('ignora outros cookies e o header ausente', () => {
    expect(hasSessionCookie('session_token=abc; space-sports.session_data=x')).toBe(false);
    expect(hasSessionCookie('')).toBe(false);
    expect(hasSessionCookie(null)).toBe(false);
  });
});
