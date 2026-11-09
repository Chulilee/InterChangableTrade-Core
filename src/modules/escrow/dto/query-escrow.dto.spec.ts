import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_PAGE } from '@app/common';
import { QueryEscrowDto } from './query-escrow.dto';
import { EscrowStatus } from '../enums/escrow-status.enum';

describe('QueryEscrowDto', () => {
  it('coerces string page and limit query values', async () => {
    const dto = plainToInstance(QueryEscrowDto, {
      page: '2',
      limit: '50',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
    expect(dto.skip).toBe(50);
  });

  it('applies the shared pagination defaults', async () => {
    const dto = plainToInstance(QueryEscrowDto, {});

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.skip).toBe(0);
  });

  it('rejects a page beyond the shared maximum', async () => {
    const dto = plainToInstance(QueryEscrowDto, {
      page: String(MAX_PAGE + 1),
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'page')).toBe(true);
  });

  it('rejects a non-numeric page', async () => {
    const dto = plainToInstance(QueryEscrowDto, { page: 'two' });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'page')).toBe(true);
  });

  it('keeps the escrow-specific filters', async () => {
    const dto = plainToInstance(QueryEscrowDto, {
      status: EscrowStatus.FUNDED,
      creatorId: '11111111-1111-4111-8111-111111111111',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.status).toBe(EscrowStatus.FUNDED);
    expect(dto.creatorId).toBe('11111111-1111-4111-8111-111111111111');
  });
});
