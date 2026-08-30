# Liquidity Aggregator

The Liquidity Aggregator module centralizes pool discovery, pricing, route planning, and arbitrage evaluation across the trading stack.

## Responsibilities

- Register and refresh liquidity pools
- Track pool snapshots and route cache state
- Compute prices and estimate price impact for candidate paths
- Build and analyze route graphs and multi-route splits
- Detect arbitrage opportunities and simulate execution outcomes
- Expose the orchestration API through the Nest controller

## Core flow

1. Pools are registered and monitored for health.
2. Price and route data are normalized into a graph model.
3. The module evaluates routes, split paths, and execution simulations.
4. Alerts and arbitrage signals are surfaced through the API layer.

## Main services

- `PoolRegistryService`
- `PriceOracleService`
- `RouteGraphService`
- `PriceImpactService`
- `MultiRouteSplitterService`
- `LiquidityMonitoringService`
- `RouteExecutionSimulatorService`
- `LiquidityAggregatorService`
