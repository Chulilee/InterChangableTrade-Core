import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryKycDto } from './query-kyc.dto';

describe('QueryKycDto', () => {
  it('coerces string page and limit query values', async () => {
    const dto = plainToInstance(QueryKycDto, {
      page: '2',
      limit: '10',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
  });

  it('parses transactionsBlocked=false as false', async () => {
    const dto = plainToInstance(QueryKycDto, {
      transactionsBlocked: 'false',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.transactionsBlocked).toBe(false);
  });

  it('parses transactionsBlocked=true as true', async () => {
    const dto = plainToInstance(QueryKycDto, {
      transactionsBlocked: 'true',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.transactionsBlocked).toBe(true);
  });

  it('rejects a non-boolean transactionsBlocked value', async () => {
    const dto = plainToInstance(QueryKycDto, {
      transactionsBlocked: 'yes',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'transactionsBlocked')).toBe(
      true,
    );
  });

  it('normalises a lowercase region code', async () => {
    const dto = plainToInstance(QueryKycDto, { region: ' de ' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.region).toBe('DE');
  });
});
