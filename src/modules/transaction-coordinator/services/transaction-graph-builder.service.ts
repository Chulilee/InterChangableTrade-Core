import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SwapLegDto } from '../dto/create-batch.dto';
import { BatchLeg } from '../entities/batch-leg.entity';

/**
 * Represents a node in the transaction dependency graph.
 */
interface GraphNode {
  legIndex: number;
  dependencies: number[];
  dependents: number[];
}

/**
 * Represents the full transaction graph for a batch.
 */
export interface TransactionGraph {
  nodes: Map<number, GraphNode>;
  /** Topologically sorted execution layers (legs in same layer can run in parallel) */
  executionLayers: number[][];
  /** Whether the graph has any cycles */
  hasCycle: boolean;
  /** Topological order of legs */
  topologicalOrder: number[];
}

/**
 * Builds and validates dependency graphs between contract invocations.
 *
 * The graph builder ensures that multi-leg swaps execute in the correct
 * order, respecting dependencies between legs. Legs with no dependencies
 * can execute in parallel for maximum throughput.
 *
 * Acceptance criteria: sub-millisecond graph construction for complex swaps.
 */
@Injectable()
export class TransactionGraphBuilderService {
  private readonly logger = new Logger(TransactionGraphBuilderService.name);

  /**
   * Build a dependency graph from a list of swap legs DTOs.
   * Returns an execution plan grouped into parallel layers.
   */
  buildGraphFromDtos(legs: SwapLegDto[]): TransactionGraph {
    const startTime = Date.now();
    const graph = this.createEmptyGraph(legs.length);

    // Add edges from explicit dependencies
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      if (leg.dependencies) {
        for (const depIndex of leg.dependencies) {
          if (depIndex < 0 || depIndex >= legs.length) {
            throw new BadRequestException(
              `Leg ${i} has invalid dependency index ${depIndex}`,
            );
          }
          if (depIndex === i) {
            throw new BadRequestException(`Leg ${i} cannot depend on itself`);
          }
          this.addEdge(graph, depIndex, i);
        }
      }

      // Auto-detect implicit dependencies: if a leg's source asset matches
      // a previous leg's destination asset, add a dependency
      for (let j = 0; j < i; j++) {
        if (this.hasImplicitDependency(legs[i], legs[j])) {
          this.addEdge(graph, j, i);
        }
      }
    }

    // Topological sort and cycle detection
    const topologicalOrder = this.topologicalSort(graph);

    if (topologicalOrder.length < legs.length) {
      throw new BadRequestException(
        'Cycle detected in transaction dependency graph',
      );
    }

    // Build execution layers
    graph.executionLayers = this.buildExecutionLayers(graph, topologicalOrder);
    graph.topologicalOrder = topologicalOrder;

    const elapsed = Date.now() - startTime;
    this.logger.debug(
      `Transaction graph built in ${elapsed}ms for ${legs.length} legs`,
    );

    return graph;
  }

  /**
   * Build a dependency graph from persisted BatchLeg entities.
   */
  buildGraphFromLegs(legs: BatchLeg[]): TransactionGraph {
    const graph = this.createEmptyGraph(legs.length);

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      for (const depId of leg.dependencies) {
        const depIndex = legs.findIndex((l) => l.id === depId);
        if (depIndex !== -1) {
          this.addEdge(graph, depIndex, i);
        }
      }
    }

    const topologicalOrder = this.topologicalSort(graph);

    if (topologicalOrder.length < legs.length) {
      throw new BadRequestException(
        'Cycle detected in transaction dependency graph',
      );
    }

    graph.executionLayers = this.buildExecutionLayers(graph, topologicalOrder);
    graph.topologicalOrder = topologicalOrder;

    return graph;
  }

  /**
   * Validate that a dependency graph is acyclic and all dependencies exist.
   */
  validateGraph(graph: TransactionGraph): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (graph.hasCycle) {
      errors.push('Graph contains a cycle');
    }

    if (graph.topologicalOrder.length === 0) {
      errors.push('Graph has no valid topological order');
    }

    // Check that all dependency references exist
    graph.nodes.forEach((node, index) => {
      for (const dep of node.dependencies) {
        if (!graph.nodes.has(dep)) {
          errors.push(`Leg ${index} depends on non-existent leg ${dep}`);
        }
      }
    });

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get the set of legs that can execute next (all dependencies satisfied).
   */
  getReadyLegs(
    graph: TransactionGraph,
    completedLegs: Set<number>,
    failedLegs: Set<number>,
  ): number[] {
    const ready: number[] = [];

    for (const [index, node] of graph.nodes) {
      if (completedLegs.has(index) || failedLegs.has(index)) {
        continue;
      }

      const allDepsCompleted = node.dependencies.every((dep) =>
        completedLegs.has(dep),
      );

      if (allDepsCompleted) {
        ready.push(index);
      }
    }

    return ready;
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private createEmptyGraph(nodeCount: number): TransactionGraph {
    const nodes = new Map<number, GraphNode>();
    for (let i = 0; i < nodeCount; i++) {
      nodes.set(i, {
        legIndex: i,
        dependencies: [],
        dependents: [],
      });
    }
    return {
      nodes,
      executionLayers: [],
      hasCycle: false,
      topologicalOrder: [],
    };
  }

  private addEdge(graph: TransactionGraph, from: number, to: number): void {
    const fromNode = graph.nodes.get(from)!;
    const toNode = graph.nodes.get(to)!;

    if (!fromNode.dependencies.includes(to)) {
      fromNode.dependents.push(to);
    }
    if (!toNode.dependencies.includes(from)) {
      toNode.dependencies.push(from);
    }
  }

  /**
   * Check if leg B is a prerequisite for leg A (implicit dependency).
   * A leg depends on a previous leg if its source asset matches
   * the previous leg's destination asset.
   */
  private hasImplicitDependency(
    current: SwapLegDto,
    previous: SwapLegDto,
  ): boolean {
    return (
      current.sourceAssetCode === previous.destAssetCode &&
      current.sourceAssetIssuer === previous.destAssetIssuer
    );
  }

  /**
   * Kahn's algorithm for topological sort with cycle detection.
   */
  private topologicalSort(graph: TransactionGraph): number[] {
    const inDegree = new Map<number, number>();
    const queue: number[] = [];
    const result: number[] = [];

    // Calculate in-degrees
    graph.nodes.forEach((node, index) => {
      inDegree.set(index, node.dependencies.length);
      if (node.dependencies.length === 0) {
        queue.push(index);
      }
    });

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      const node = graph.nodes.get(current)!;
      for (const dependent of node.dependents) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    // If result doesn't contain all nodes, there's a cycle
    if (result.length < graph.nodes.size) {
      graph.hasCycle = true;
    }

    return result;
  }

  /**
   * Group legs into parallel execution layers.
   * Layer 0 = legs with no dependencies
   * Layer N = legs whose dependencies are all in layers < N
   */
  private buildExecutionLayers(
    graph: TransactionGraph,
    topologicalOrder: number[],
  ): number[][] {
    const layerMap = new Map<number, number>();

    for (const nodeIndex of topologicalOrder) {
      const node = graph.nodes.get(nodeIndex)!;
      if (node.dependencies.length === 0) {
        layerMap.set(nodeIndex, 0);
      } else {
        const maxDepLayer = Math.max(
          ...node.dependencies.map((dep) => layerMap.get(dep) ?? 0),
        );
        layerMap.set(nodeIndex, maxDepLayer + 1);
      }
    }

    // Group by layer
    const layers: number[][] = [];
    for (const [nodeIndex, layer] of layerMap) {
      if (!layers[layer]) {
        layers[layer] = [];
      }
      layers[layer].push(nodeIndex);
    }

    return layers;
  }
}
