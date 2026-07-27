import { DisputePatternDetectionService } from './dispute-pattern-detection.service';
import { Dispute } from '../entities/dispute.entity';
import { DisputeClassification } from '../enums/dispute-classification.enum';
import { DisputeStatus } from '../enums/dispute-status.enum';

describe('DisputePatternDetectionService', () => {
  let service: DisputePatternDetectionService;
  let repo: { find: jest.Mock; save: jest.Mock };

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      save: jest.fn((v) => Promise.resolve(v)),
    };
    service = new DisputePatternDetectionService(repo as never);
  });

  const baseDispute: Partial<Dispute> = {
    id: 'dispute-new',
    tradeId: 'trade-1',
    complainantId: 'user-a',
    respondentId: 'user-b',
    classification: DisputeClassification.FRAUD,
    status: DisputeStatus.FILED,
  };

  it('detects similar disputes on same trade', async () => {
    repo.find.mockResolvedValue([
      {
        id: 'dispute-old',
        tradeId: 'trade-1',
        complainantId: 'user-c',
        respondentId: 'user-d',
        classification: DisputeClassification.FRAUD,
        status: DisputeStatus.RESOLVED,
      },
    ]);

    const matches = await service.detectSimilarDisputes(baseDispute as Dispute);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].matchReasons).toContain('same_trade');
    expect(matches[0].similarityScore).toBeGreaterThanOrEqual(30);
  });

  it('detects same party disputes', async () => {
    repo.find.mockResolvedValue([
      {
        id: 'dispute-old',
        tradeId: 'trade-2',
        complainantId: 'user-a',
        respondentId: 'user-x',
        classification: DisputeClassification.FRAUD,
        status: DisputeStatus.INVESTIGATION,
      },
    ]);

    const matches = await service.detectSimilarDisputes(baseDispute as Dispute);

    expect(matches[0].matchReasons).toContain('same_party');
  });

  it('flags dispute when similar ones exist', async () => {
    repo.find.mockResolvedValue([
      {
        id: 'dispute-old',
        tradeId: 'trade-1',
        complainantId: 'user-c',
        respondentId: 'user-d',
        classification: DisputeClassification.FRAUD,
        status: DisputeStatus.RESOLVED,
      },
    ]);

    const dispute = {
      ...baseDispute,
      similarDisputesFlagged: false,
      metadata: {},
    };
    const flagged = await service.flagIfSimilar(dispute as Dispute);

    expect(flagged).toBe(true);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ similarDisputesFlagged: true }),
    );
  });

  it('returns false when no similar disputes', async () => {
    repo.find.mockResolvedValue([]);

    const dispute = { ...baseDispute, metadata: {} };
    const flagged = await service.flagIfSimilar(dispute as Dispute);

    expect(flagged).toBe(false);
  });
});
