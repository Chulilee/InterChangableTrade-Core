import { HttpStatus } from '@nestjs/common';
import {
  SorobanApplicationError,
  SorobanContractError,
  SorobanErrorCategory,
  SorobanNetworkError,
  SorobanValidationError,
  classifySdkError,
} from './soroban.errors';

describe('Soroban error hierarchy', () => {
  it('maps each error to its category and HTTP status', () => {
    expect(new SorobanNetworkError('x').category).toBe(
      SorobanErrorCategory.NETWORK,
    );
    expect(new SorobanNetworkError('x').getStatus()).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(new SorobanContractError('x').getStatus()).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    expect(new SorobanApplicationError('x').getStatus()).toBe(
      HttpStatus.BAD_REQUEST,
    );
    expect(new SorobanValidationError('x').category).toBe(
      SorobanErrorCategory.VALIDATION,
    );
  });

  it('exposes structured details without leaking the cause', () => {
    const err = new SorobanContractError('boom', {
      contractId: 'C123',
      method: 'transfer',
      diagnostics: ['trap'],
      cause: new Error('secret'),
    });
    const detail = err.toDetail();
    expect(detail).toMatchObject({
      category: SorobanErrorCategory.CONTRACT,
      contractId: 'C123',
      method: 'transfer',
      diagnostics: ['trap'],
    });
    expect(JSON.stringify(detail)).not.toContain('secret');
  });
});

describe('classifySdkError', () => {
  it('passes through an existing SorobanError unchanged', () => {
    const original = new SorobanValidationError('bad');
    expect(classifySdkError(original)).toBe(original);
  });

  it.each([
    'Connection ECONNREFUSED',
    'request timed out',
    'fetch failed',
    'Request failed with status code 502 Bad Gateway',
  ])('classifies %j as a network error', (message) => {
    const result = classifySdkError(new Error(message));
    expect(result).toBeInstanceOf(SorobanNetworkError);
    expect(result.category).toBe(SorobanErrorCategory.NETWORK);
  });

  it.each([
    'HostFunctionError: trapped',
    'contract call unauthorized',
    'InvokeHostFunction failed',
  ])('classifies %j as a contract error', (message) => {
    const result = classifySdkError(new Error(message));
    expect(result).toBeInstanceOf(SorobanContractError);
  });

  it('defaults unknown errors to application errors and preserves the cause', () => {
    const cause = new Error('something odd');
    const result = classifySdkError(cause);
    expect(result).toBeInstanceOf(SorobanApplicationError);
    expect(result.details.cause).toBe(cause);
  });

  it('merges caller-provided details', () => {
    const result = classifySdkError(new Error('timeout'), {
      contractId: 'CABC',
    });
    expect(result.details.contractId).toBe('CABC');
  });
});
