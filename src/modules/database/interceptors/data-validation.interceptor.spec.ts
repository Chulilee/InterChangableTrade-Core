import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { DataValidationInterceptor } from './data-validation.interceptor';
import { of } from 'rxjs';

describe('DataValidationInterceptor', () => {
  let interceptor: DataValidationInterceptor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataValidationInterceptor],
    }).compile();

    interceptor = module.get(DataValidationInterceptor);
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  describe('intercept', () => {
    it('should pass through valid data', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => ({
            data: { id: '123', name: 'Test' },
          }),
        }),
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: () => of({ data: { id: '123', name: 'Test' } }),
      } as CallHandler;

      const result = await interceptor.intercept(mockContext, mockCallHandler).toPromise();

      expect(result).toEqual({ data: { id: '123', name: 'Test' } });
    });

    it('should throw for invalid entity ID', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => ({
            data: { id: 123, name: 'Test' },
          }),
        }),
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: () => of({ data: { id: 123, name: 'Test' } }),
      } as CallHandler;

      try {
        await interceptor.intercept(mockContext, mockCallHandler).toPromise();
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as any).message).toContain('Data validation failed');
      }
    });

    it('should throw for negative amount', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => ({
            data: { id: '123', amount: -10 },
          }),
        }),
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: () => of({ data: { id: '123', amount: -10 } }),
      } as CallHandler;

      try {
        await interceptor.intercept(mockContext, mockCallHandler).toPromise();
        fail('Should have thrown');
      } catch (error) {
        expect((error as any).message).toContain('Data validation failed');
      }
    });
  });

  describe('validateEntity', () => {
    it('should validate null entity', () => {
      const result = interceptor['validateEntity'](null);

      expect(result.valid).toBe(false);
      expect(Array.isArray(result.errors)).toBe(true);
      expect((result as any).errors.length).toBeGreaterThan(0);
    });

    it('should validate date fields', () => {
      const result = interceptor['validateEntity']({
        id: '123',
        createdAt: 'invalid-date',
        updatedAt: new Date(),
      });

      expect(result.valid).toBe(false);
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should validate numeric fields', () => {
      const result = interceptor['validateEntity']({
        id: '123',
        amount: -5,
        price: 0,
      });

      expect(result.valid).toBe(false);
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });
});
