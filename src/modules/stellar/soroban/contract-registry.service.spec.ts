import { ContractRegistryService } from './contract-registry.service';

describe('ContractRegistryService (issue #89)', () => {
  const makeRegistry = () => {
    const abiService = { registerFromXdr: jest.fn() };
    const config = { get: jest.fn() };
    return new ContractRegistryService(abiService as never, config as never);
  };

  const metadata = (contractId: string, isActive: boolean) => ({
    contractId,
    type: 'swap-pool',
    version: contractId,
    capabilities: ['swap'],
    deployedAt: 1,
    isActive,
  });

  it('deactivates same-type siblings when registering an active contract', () => {
    const registry = makeRegistry();
    registry.register(metadata('Cold', true));
    registry.register(metadata('Cnew', true));

    expect(registry.getMetadata('Cold').isActive).toBe(false);
    expect(registry.getMetadata('Cnew').isActive).toBe(true);
  });

  it('does not mutate the caller object on register or setActive', () => {
    const registry = makeRegistry();
    const input = metadata('Cold', true);
    registry.register(input);
    registry.register(metadata('Cnew', false));
    registry.setActive('Cnew');

    // The caller's object is untouched by registry state changes.
    expect(input.isActive).toBe(true);
    expect(registry.getMetadata('Cold').isActive).toBe(false);
    expect(registry.getMetadata('Cnew').isActive).toBe(true);
  });

  it('returns copies from getMetadata so callers cannot mutate registry state', () => {
    const registry = makeRegistry();
    registry.register(metadata('Cold', true));

    const copy = registry.getMetadata('Cold');
    copy.isActive = false;
    copy.capabilities.push('mutated');

    expect(registry.getMetadata('Cold').isActive).toBe(true);
    expect(registry.getMetadata('Cold').capabilities).toEqual(['swap']);
  });
});
