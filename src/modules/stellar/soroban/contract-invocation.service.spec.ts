import { ContractInvocationService } from './contract-invocation.service';
import {
  SorobanApplicationError,
  SorobanContractError,
} from './soroban.errors';

/**
 * These tests exercise the invocation control flow (validate -> build ->
 * simulate -> [sign -> submit]) with the SDK-touching client and ABI fully
 * mocked, so no network or real key material is involved.
 */
describe('ContractInvocationService', () => {
  const CONTRACT = 'CABC';
  const SIGNER_PK = 'GSIGNER';

  let client: any;
  let abi: any;
  let service: ContractInvocationService;

  const simSuccess = {
    result: { retval: { __scval: 'raw' } },
    minResourceFee: '1000',
    cost: { cpuInsns: '500', memBytes: '2048' },
    latestLedger: 55,
  };

  beforeEach(() => {
    client = {
      hasSigner: jest.fn(() => true),
      requireSigner: jest.fn(() => ({
        publicKey: () => SIGNER_PK,
      })),
      getNetworkPassphrase: jest.fn(() => 'Test SDF Network ; September 2015'),
      getAccount: jest.fn().mockResolvedValue({ accountId: () => SIGNER_PK }),
      simulate: jest.fn().mockResolvedValue(simSuccess),
      prepareTransaction: jest.fn(async (tx) => tx),
      sendAndConfirm: jest.fn().mockResolvedValue({
        txHash: 'HASH123',
        ledger: 56,
        returnValue: { __scval: 'raw' },
      }),
    };
    abi = {
      validateAndBuildArgs: jest.fn(() => []),
      decodeResult: jest.fn(() => ({ ok: true })),
    };
    const config = { get: () => 30 };
    service = new ContractInvocationService(
      client as never,
      abi as never,
      config as never,
    );

    // Stub the transaction build so we don't construct a real Stellar tx.
    jest
      .spyOn(service as any, 'buildInvocationTx')
      .mockResolvedValue({ sign: jest.fn() });
  });

  describe('simulate', () => {
    it('validates args, simulates, and decodes the result — no signing', async () => {
      const out = await service.simulate({
        contractId: CONTRACT,
        method: 'balance',
        args: { id: 1 },
      });

      expect(abi.validateAndBuildArgs).toHaveBeenCalledWith(
        CONTRACT,
        'balance',
        { id: 1 },
      );
      expect(client.sendAndConfirm).not.toHaveBeenCalled();
      expect(out.result).toEqual({ ok: true });
      expect(out.gas).toEqual({
        minResourceFee: '1000',
        cpuInstructions: '500',
        memoryBytes: '2048',
      });
      expect(out.latestLedger).toBe(55);
    });

    it('throws a contract error when simulation returns no result', async () => {
      client.simulate.mockResolvedValueOnce({ ...simSuccess, result: null });
      await expect(
        service.simulate({ contractId: CONTRACT, method: 'balance' }),
      ).rejects.toBeInstanceOf(SorobanContractError);
    });
  });

  describe('estimateGas', () => {
    it('returns the projected fee without submitting', async () => {
      const gas = await service.estimateGas({
        contractId: CONTRACT,
        method: 'balance',
      });
      expect(gas.minResourceFee).toBe('1000');
      expect(client.sendAndConfirm).not.toHaveBeenCalled();
    });
  });

  describe('invoke', () => {
    it('simulates, signs, submits, and returns the confirmed result', async () => {
      const out = await service.invoke({
        contractId: CONTRACT,
        method: 'transfer',
        args: { to: 'GX', amount: 5 },
      });

      expect(client.requireSigner).toHaveBeenCalled();
      expect(client.prepareTransaction).toHaveBeenCalled();
      expect(client.sendAndConfirm).toHaveBeenCalled();
      expect(out).toMatchObject({
        contractId: CONTRACT,
        method: 'transfer',
        transactionHash: 'HASH123',
        status: 'SUCCESS',
        ledger: 56,
        result: { ok: true },
      });
    });

    it('propagates the application error when no signer is configured', async () => {
      client.requireSigner.mockImplementationOnce(() => {
        throw new SorobanApplicationError('no signer');
      });
      await expect(
        service.invoke({ contractId: CONTRACT, method: 'transfer' }),
      ).rejects.toBeInstanceOf(SorobanApplicationError);
    });
  });
});
