#!/usr/bin/env node
/**
 * Verifies that docs/environment.md documents every environment variable
 * declared in src/config/env.validation.ts. Fails with a non-zero exit code if
 * a schema variable is missing from the documentation or if .env.example drifts
 * from the schema (delegated to the Joi schema description + .env.example parse
 * checks used by env.validation.spec.ts).
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const schemaPath = path.join(root, 'src', 'config', 'env.validation.ts');
const docsPath = path.join(root, 'docs', 'environment.md');
const examplePath = path.join(root, '.env.example');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function fail(messages) {
  console.error('Environment documentation check failed:');
  for (const message of messages) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

const errors = [];

// Extract Joi schema keys declared as `KEY: Joi...` in env.validation.ts.
const schemaSource = read(schemaPath);
const schemaKeyRe = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*Joi\./gm;
const schemaKeys = new Set();
let match;
while ((match = schemaKeyRe.exec(schemaSource)) !== null) {
  schemaKeys.add(match[1]);
}

if (schemaKeys.size === 0) {
  fail(['Could not parse any schema keys from src/config/env.validation.ts']);
}

const docs = read(docsPath);
const undocumented = [...schemaKeys].filter((key) => !new RegExp(`\\\`${key}\\\``).test(docs));
if (undocumented.length > 0) {
  errors.push(`docs/environment.md is missing variables: ${undocumented.join(', ')}`);
}

// .env.example must list every schema key (including commented optional ones).
const example = read(examplePath);
const listed = new Set(
  example
    .split(/\r?\n/)
    .map((line) => {
      const m = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line.trim());
      return m ? m[1] : null;
    })
    .filter(Boolean),
);

const unlistedInExample = [...schemaKeys].filter((key) => !listed.has(key));
if (unlistedInExample.length > 0) {
  errors.push(`.env.example is missing variables: ${unlistedInExample.join(', ')}`);
}

const undeclaredInSchema = [...listed].filter((key) => !schemaKeys.has(key));
if (undeclaredInSchema.length > 0) {
  errors.push(`.env.example lists undeclared variables: ${undeclaredInSchema.join(', ')}`);
}

if (errors.length > 0) {
  fail(errors);
}

console.log(
  `Environment documentation check passed (${schemaKeys.size} schema variables documented and listed in .env.example).`,
);
