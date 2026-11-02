import { Logger } from '@nestjs/common';
import { AuthTokenLookupService } from './auth-token-lookup.service';

function createConfig(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as never;
}

describe('AuthTokenLookupService (issue #81)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('produces a stable 64-char hex digest for the same credential', () => {
    const service = new AuthTokenLookupService(
      createConfig({ 'auth.tokenPepper': 'pepper-value-16-chars' }),
    );

    const first = service.digest('raw-secret');
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(service.digest('raw-secret')).toBe(first);
    expect(service.digest('other-secret')).not.toBe(first);
  });

  it('keys the digest on the pepper, so a different pepper yields a different hash', () => {
    const a = new AuthTokenLookupService(
      createConfig({ 'auth.tokenPepper': 'pepper-a-at-least-16' }),
    );
    const b = new AuthTokenLookupService(
      createConfig({ 'auth.tokenPepper': 'pepper-b-at-least-16' }),
    );

    expect(a.digest('raw-secret')).not.toBe(b.digest('raw-secret'));
  });

  it('falls back to JWT_SECRET when no dedicated pepper is configured', () => {
    const service = new AuthTokenLookupService(
      createConfig({ 'jwt.secret': 'jwt-secret-at-least-16-characters' }),
    );
    const explicit = new AuthTokenLookupService(
      createConfig({ 'auth.tokenPepper': 'jwt-secret-at-least-16-characters' }),
    );

    expect(service.digest('raw-secret')).toBe(explicit.digest('raw-secret'));
  });
});
