import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'dotenv';
import { envValidationSchema } from './env.validation';

describe('envValidationSchema vs .env.example', () => {
  const raw = readFileSync(join(__dirname, '..', '..', '.env.example'), 'utf8');

  // Keys that are set, as dotenv reads them (commented lines are skipped).
  const active = parse(raw);

  // Every key the file documents, including optional ones left commented out
  // (`# KEY=`), so optional secrets are listed without being set.
  const listed = new Set(
    raw
      .split(/\r?\n/)
      .map((line) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
      .filter((key): key is string => Boolean(key)),
  );

  const schemaKeys = Object.keys(
    (envValidationSchema.describe() as { keys: Record<string, unknown> }).keys,
  );

  it('validates strictly: cp .env.example .env yields a valid config', () => {
    const { error } = envValidationSchema.validate(active, {
      abortEarly: false,
      allowUnknown: false,
    });

    expect(error?.details.map((d) => d.message)).toBeUndefined();
  });

  it('declares every key listed in .env.example', () => {
    const undeclared = [...listed].filter((key) => !schemaKeys.includes(key));

    expect(undeclared).toEqual([]);
  });

  it('lists every declared key in .env.example', () => {
    const unlisted = schemaKeys.filter((key) => !listed.has(key));

    expect(unlisted).toEqual([]);
  });
});

describe('envValidationSchema: CORS_ALLOWED_ORIGINS guard', () => {
  const raw = readFileSync(join(__dirname, '..', '..', '.env.example'), 'utf8');
  const active = parse(raw);
  const productionEnv = { ...active, NODE_ENV: 'production' };

  function validate(env: Record<string, unknown>) {
    return envValidationSchema.validate(env, {
      abortEarly: false,
      allowUnknown: false,
    });
  }

  it('is required in production', () => {
    const { error } = validate({
      ...productionEnv,
      CORS_ALLOWED_ORIGINS: undefined,
    });

    const messages = error?.details.map((d) => d.message) ?? [];
    expect(messages.some((m) => m.includes('CORS_ALLOWED_ORIGINS'))).toBe(true);
  });

  it('rejects a bare wildcard in production', () => {
    const { error } = validate({ ...productionEnv, CORS_ALLOWED_ORIGINS: '*' });

    const messages = error?.details.map((d) => d.message) ?? [];
    expect(messages.some((m) => m.includes('CORS_ALLOWED_ORIGINS'))).toBe(true);
  });

  it('rejects a wildcard hidden among valid origins', () => {
    const { error } = validate({
      ...productionEnv,
      CORS_ALLOWED_ORIGINS: 'https://app.example.com, *',
    });

    expect(error).toBeDefined();
  });

  it('rejects an empty allowlist in production', () => {
    const { error } = validate({ ...productionEnv, CORS_ALLOWED_ORIGINS: '' });

    expect(error).toBeDefined();
  });

  it('accepts an explicit allowlist in production', () => {
    const { error } = validate({
      ...productionEnv,
      CORS_ALLOWED_ORIGINS:
        'https://app.example.com,https://admin.example.com',
    });

    expect(error?.details.map((d) => d.message)).toBeUndefined();
  });

  it('stays optional with an empty value outside production', () => {
    const { error } = validate({ ...active });

    expect(error?.details.map((d) => d.message)).toBeUndefined();
  });
});
