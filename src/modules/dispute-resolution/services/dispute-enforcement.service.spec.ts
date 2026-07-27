import { DisputeEnforcementService } from './dispute-enforcement.service';
import { Dispute } from '../entities/dispute.entity';
import { DisputeResolutionType } from '../enums/dispute-resolution-type.enum';
import { DisputeStatus } from '../enums/dispute-status.enum';
import { DisputeClassification } from '../enums/dispute-classification.enum';

describe('DisputeEnforcementService', () => {
  let service: DisputeEnforcementService;
  let disputeRepo: { findOne: jest.Mock; save: jest.Mock };
  let tradeRepo: { findOne: jest.Mock };
  let transactionsService: { record: jest.Mock };

  beforeEach(() => {
    disputeRepo = {
      findOne: jest.fn(),
      save: jest.fn((v) => Promise.resolve(v)),
    };
    tradeRepo = {
      findOne: jest.fn(),
    };
    transactionsService = {
      record: jest.fn().mockResolvedValue({ id: 'tx-1' }),
    };

    service = new DisputeEnforcementService(
      disputeRepo as never,
      tradeRepo as never,
      transactionsService as never,
    );
  });

  const baseDispute: Partial<Dispute> = {
    id: 'dispute-1',
    tradeId: 'trade-1',
    complainantId: 'user-a',
    respondentId: 'user-b',
    classification: DisputeClassification.NON_DELIVERY,
    status: DisputeStatus.RESOLVED,
    enforcementExecuted: false,
    resolutionAmount: '50.0000000',
  };

  it('creates refund transaction for REFUND resolution', async () => {
    tradeRepo.findOne.mockResolvedValue({
      id: 'trade-1',
      assetCode: 'XLM',
      assetIssuer: null,
      quantity: '100.0000000',
    });

    const dispute = {
      ...baseDispute,
      resolutionType: DisputeResolutionType.REFUND,
    } as Dispute;

    await service.executeEnforcement(dispute);

    expect(transactionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-a',
        amount: '50.0000000',
      }),
    );
    expect(disputeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ enforcementExecuted: true }),
    );
  });

  it('skips enforcement for dismissed disputes', async () => {
    const dispute = {
      ...baseDispute,
      resolutionType: DisputeResolutionType.DISMISSED,
    } as Dispute;

    await service.executeEnforcement(dispute);

    expect(transactionsService.record).not.toHaveBeenCalled();
    expect(disputeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ enforcementExecuted: true }),
    );
  });

  it('creates reversal transaction for REVERSAL resolution', async () => {
    tradeRepo.findOne.mockResolvedValue({
      id: 'trade-1',
      assetCode: 'XLM',
      assetIssuer: null,
      quantity: '100.0000000',
    });

    const dispute = {
      ...baseDispute,
      resolutionType: DisputeResolutionType.REVERSAL,
    } as Dispute;

    await service.executeEnforcement(dispute);

    expect(transactionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-b' }),
    );
  });

  it('re-executes enforcement after appeal reset', async () => {
    tradeRepo.findOne.mockResolvedValue({
      id: 'trade-1',
      assetCode: 'XLM',
      assetIssuer: null,
      quantity: '100.0000000',
    });

    const dispute = {
      ...baseDispute,
      enforcementExecuted: false,
      resolutionType: DisputeResolutionType.REFUND,
    } as Dispute;

    await service.executeEnforcement(dispute);

    expect(transactionsService.record).toHaveBeenCalled();
  });

  it('does not re-execute already enforced disputes', async () => {
    const dispute = {
      ...baseDispute,
      enforcementExecuted: true,
      resolutionType: DisputeResolutionType.REFUND,
    } as Dispute;

    await service.executeEnforcement(dispute);

    expect(transactionsService.record).not.toHaveBeenCalled();
  });

  it('creates settlement transaction for SETTLEMENT resolution', async () => {
    tradeRepo.findOne.mockResolvedValue({
      id: 'trade-1',
      assetCode: 'USDC',
      assetIssuer: 'issuer-1',
      quantity: '100.0000000',
    });

    const dispute = {
      ...baseDispute,
      resolutionType: DisputeResolutionType.SETTLEMENT,
      resolutionAmount: null,
    } as Dispute;

    await service.executeEnforcement(dispute);

    expect(transactionsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-a',
        amount: '100.0000000',
        assetCode: 'USDC',
      }),
    );
  });
});
