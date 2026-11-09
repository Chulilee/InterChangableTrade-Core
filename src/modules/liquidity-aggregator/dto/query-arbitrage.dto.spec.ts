import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_PAGE } from '@app/common';
import { QueryArbitrageDto } from './index';

describe('QueryArbitrageDto', () => {
  it('coerces a string minSpread to a number', async () => {
    const dto = plainToInstance(QueryArbitrageDto, { minSpread: '1.5' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.minSpread).toBe(1.5);
  });

  it('coerces string page and limit query values', async () => {
    const dto = plainToInstance(QueryArbitrageDto, {
      page: '2',
      limit: '25',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(25);
  });

  it('applies the default minimum spread', async () => {
    const dto = plainToInstance(QueryArbitrageDto, {});

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.minSpread).toBe(0.1);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('rejects a negative minimum spread', async () => {
    const dto = plainToInstance(QueryArbitrageDto, { minSpread: '-1' });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'minSpread')).toBe(true);
  });

  it('rejects a non-numeric minimum spread', async () => {
    const dto = plainToInstance(QueryArbitrageDto, { minSpread: 'wide' });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'minSpread')).toBe(true);
  });

  it('rejects a page beyond the shared maximum', async () => {
    const dto = plainToInstance(QueryArbitrageDto, {
      page: String(MAX_PAGE + 1),
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'page')).toBe(true);
  });
});
