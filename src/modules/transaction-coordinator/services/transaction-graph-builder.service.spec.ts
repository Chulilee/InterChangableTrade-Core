import { BadRequestException } from '@nestjs/common';
import { TransactionGraphBuilderService } from './transaction-graph-builder.service';
import { SwapLegDto } from '../dto/create-batch.dto';
import { BatchLeg, LegStatus } from '../entities/batch-leg.entity';

describe('TransactionGraphBuilderService', () => {
  let service: TransactionGraphBuilderService;

  beforeEach(() => {
    service = new TransactionGraphBuilderService();
  });

  describe('buildGraphFromDtos', () => {
    it('should build a simple linear graph from sequential legs', () => {
      const legs: SwapLegDto[] = [
        {
          contractId: 'c1',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'EUR',
          amount: 100,
          minAmountOut: 90,
        },
        {
          contractId: 'c2',
          method: 'swap',
          sourceAssetCode: 'EUR',
          destAssetCode: 'JPY',
          amount: 90,
          minAmountOut: 14000,
        },
      ];

      const graph = service.buildGraphFromDtos(legs);

      expect(graph.hasCycle).toBe(false);
      expect(graph.topologicalOrder).toHaveLength(2);
      // Second leg depends on first (implicit: EUR → EUR)
      expect(graph.executionLayers.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect explicit dependencies', () => {
      const legs: SwapLegDto[] = [
        {
          contractId: 'c1',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'EUR',
          amount: 100,
          minAmountOut: 90,
        },
        {
          contractId: 'c2',
          method: 'swap',
          sourceAssetCode: 'ETH',
          destAssetCode: 'BTC',
          amount: 1,
          minAmountOut: 0.05,
          dependencies: [0],
        },
      ];

      const graph = service.buildGraphFromDtos(legs);

      expect(graph.hasCycle).toBe(false);
      // Leg 0 has no deps, leg 1 depends on leg 0
      const node0 = graph.nodes.get(0)!;
      const node1 = graph.nodes.get(1)!;
      expect(node0.dependencies).toHaveLength(0);
      expect(node1.dependencies).toContain(0);
    });

    it('should handle parallel legs with no dependencies', () => {
      const legs: SwapLegDto[] = [
        {
          contractId: 'c1',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'EUR',
          amount: 100,
          minAmountOut: 90,
        },
        {
          contractId: 'c2',
          method: 'swap',
          sourceAssetCode: 'GBP',
          destAssetCode: 'JPY',
          amount: 80,
          minAmountOut: 15000,
        },
      ];

      const graph = service.buildGraphFromDtos(legs);

      expect(graph.hasCycle).toBe(false);
      expect(graph.executionLayers.length).toBe(1); // Both can run in parallel
      expect(graph.executionLayers[0]).toHaveLength(2);
    });

    it('should throw on self-dependency', () => {
      const legs: SwapLegDto[] = [
        {
          contractId: 'c1',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'EUR',
          amount: 100,
          minAmountOut: 90,
          dependencies: [0],
        },
      ];

      expect(() => service.buildGraphFromDtos(legs)).toThrow(
        BadRequestException,
      );
    });

    it('should throw on invalid dependency index', () => {
      const legs: SwapLegDto[] = [
        {
          contractId: 'c1',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'EUR',
          amount: 100,
          minAmountOut: 90,
          dependencies: [5],
        },
      ];

      expect(() => service.buildGraphFromDtos(legs)).toThrow(
        BadRequestException,
      );
    });

    it('should handle three-leg chain: USD -> EUR -> JPY', () => {
      const legs: SwapLegDto[] = [
        {
          contractId: 'pool-usd-eur',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'EUR',
          amount: 1000,
          minAmountOut: 900,
        },
        {
          contractId: 'pool-eur-jpy',
          method: 'swap',
          sourceAssetCode: 'EUR',
          destAssetCode: 'JPY',
          amount: 900,
          minAmountOut: 140000,
        },
        {
          contractId: 'pool-jpy-usd',
          method: 'swap',
          sourceAssetCode: 'JPY',
          destAssetCode: 'USD',
          amount: 140000,
          minAmountOut: 950,
        },
      ];

      const graph = service.buildGraphFromDtos(legs);

      expect(graph.hasCycle).toBe(false);
      expect(graph.topologicalOrder).toHaveLength(3);
      // Each layer should have one leg (sequential chain)
      expect(graph.executionLayers.length).toBe(3);
      expect(graph.executionLayers[0]).toHaveLength(1);
      expect(graph.executionLayers[1]).toHaveLength(1);
      expect(graph.executionLayers[2]).toHaveLength(1);
    });
  });

  describe('buildGraphFromLegs', () => {
    it('should build graph from persisted BatchLeg entities', () => {
      const legs = [
        {
          id: 'leg-1',
          batchId: 'batch-1',
          orderIndex: 0,
          dependencies: [],
          contractId: 'c1',
          method: 'swap',
          args: {},
          sourceAssetCode: 'USD',
          sourceAssetIssuer: null,
          destAssetCode: 'EUR',
          destAssetIssuer: null,
          amount: '100',
          minAmountOut: '90',
          maxAmountOut: null,
          status: LegStatus.PREPARED,
          isConditional: false,
          conditionExpression: null,
          conditionType: null,
          expectedOutput: null,
          actualOutput: null,
          stellarTxHash: null,
          errorMessage: null,
          executionMetadata: null,
          preparedAt: null,
          executedAt: null,
          rolledBackAt: null,
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'leg-2',
          batchId: 'batch-1',
          orderIndex: 1,
          dependencies: ['leg-1'],
          contractId: 'c2',
          method: 'swap',
          args: {},
          sourceAssetCode: 'EUR',
          sourceAssetIssuer: null,
          destAssetCode: 'JPY',
          destAssetIssuer: null,
          amount: '90',
          minAmountOut: '14000',
          maxAmountOut: null,
          status: LegStatus.PREPARED,
          isConditional: false,
          conditionExpression: null,
          conditionType: null,
          expectedOutput: null,
          actualOutput: null,
          stellarTxHash: null,
          errorMessage: null,
          executionMetadata: null,
          preparedAt: null,
          executedAt: null,
          rolledBackAt: null,
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as unknown as BatchLeg[];

      const graph = service.buildGraphFromLegs(legs);

      expect(graph.hasCycle).toBe(false);
      expect(graph.topologicalOrder).toHaveLength(2);
      expect(graph.topologicalOrder[0]).toBe(0);
      expect(graph.topologicalOrder[1]).toBe(1);
    });
  });

  describe('validateGraph', () => {
    it('should validate a correct graph', () => {
      const legs: SwapLegDto[] = [
        {
          contractId: 'c1',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'EUR',
          amount: 100,
          minAmountOut: 90,
        },
        {
          contractId: 'c2',
          method: 'swap',
          sourceAssetCode: 'EUR',
          destAssetCode: 'JPY',
          amount: 90,
          minAmountOut: 14000,
        },
      ];

      const graph = service.buildGraphFromDtos(legs);
      const result = service.validateGraph(graph);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('getReadyLegs', () => {
    it('should return legs with no dependencies as ready', () => {
      const legs: SwapLegDto[] = [
        {
          contractId: 'c1',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'EUR',
          amount: 100,
          minAmountOut: 90,
        },
        {
          contractId: 'c2',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'GBP',
          amount: 100,
          minAmountOut: 80,
        },
      ];

      const graph = service.buildGraphFromDtos(legs);
      const ready = service.getReadyLegs(graph, new Set(), new Set());

      expect(ready).toHaveLength(2);
      expect(ready).toContain(0);
      expect(ready).toContain(1);
    });

    it('should only return dependent leg after dependency is completed', () => {
      const legs: SwapLegDto[] = [
        {
          contractId: 'c1',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'EUR',
          amount: 100,
          minAmountOut: 90,
        },
        {
          contractId: 'c2',
          method: 'swap',
          sourceAssetCode: 'EUR',
          destAssetCode: 'JPY',
          amount: 90,
          minAmountOut: 14000,
        },
      ];

      const graph = service.buildGraphFromDtos(legs);

      // Initially only leg 0 should be ready
      let ready = service.getReadyLegs(graph, new Set(), new Set());
      expect(ready).toHaveLength(1);
      expect(ready[0]).toBe(0);

      // After completing leg 0, leg 1 should be ready
      ready = service.getReadyLegs(graph, new Set([0]), new Set());
      expect(ready).toHaveLength(1);
      expect(ready[0]).toBe(1);
    });

    it('should not return legs that failed', () => {
      const legs: SwapLegDto[] = [
        {
          contractId: 'c1',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'EUR',
          amount: 100,
          minAmountOut: 90,
        },
        {
          contractId: 'c2',
          method: 'swap',
          sourceAssetCode: 'USD',
          destAssetCode: 'GBP',
          amount: 100,
          minAmountOut: 80,
        },
      ];

      const graph = service.buildGraphFromDtos(legs);
      const ready = service.getReadyLegs(graph, new Set(), new Set([0]));

      expect(ready).toHaveLength(1);
      expect(ready[0]).toBe(1);
    });
  });
});
