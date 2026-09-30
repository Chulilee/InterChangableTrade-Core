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
