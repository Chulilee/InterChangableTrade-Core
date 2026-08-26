import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BatchingController } from '../batching.controller';
import { BatchingService } from '../batching.service';
import { BatchStatus } from '../entities/settlement-batch.entity';

describe('BatchingController', () => {
  let controller: BatchingController;
  let service: {
    triggerManual: jest.Mock;
    findHistory: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      triggerManual: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      findHistory: jest.fn().mockResolvedValue([{ id: 'batch-1' }]),
      findOne: jest.fn().mockResolvedValue({ id: 'batch-1' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BatchingController],
      providers: [{ provide: BatchingService, useValue: service }],
    }).compile();

    controller = moduleRef.get<BatchingController>(BatchingController);
  });

  it('POST /transactions/batch triggers manual settlement', async () => {
    const res = await controller.triggerBatch();
    expect(res).toEqual({ id: 'batch-1' });
    expect(service.triggerManual).toHaveBeenCalledTimes(1);
  });

  it('GET /transactions/batches returns history, optionally filtered', async () => {
    await controller.history(BatchStatus.SETTLED);
    expect(service.findHistory).toHaveBeenCalledWith(BatchStatus.SETTLED);
    await controller.history();
    expect(service.findHistory).toHaveBeenCalledWith(undefined);
  });

  it('GET /transactions/batches/:id delegates to the service', async () => {
    const res = await controller.findOne('batch-1');
    expect(res.id).toBe('batch-1');
  });

  it('propagates 404s for unknown batches', async () => {
    service.findOne.mockRejectedValue(
      new NotFoundException('Settlement batch nope not found'),
    );
    await expect(controller.findOne('nope')).rejects.toThrow(NotFoundException);
  });
});
