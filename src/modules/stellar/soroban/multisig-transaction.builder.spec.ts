import {
  Account,
  Keypair,
  Networks,
  StrKey,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  BatchedInvocation,
  MultisigConfig,
  MultisigTransaction,
  MultisigTransactionBuilder,
} from './multisig-transaction.builder';
import { SorobanApplicationError } from './soroban.errors';

const PASSPHRASE = Networks.TESTNET;

// A valid contract strkey (C...) so the offline builder can assemble real
// InvokeHostFunction operations without any network access.
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));

const SOURCE_KP = Keypair.random();
const SIGNER_1 = Keypair.random();
const SIGNER_2 = Keypair.random();
const SIGNER_3 = Keypair.random();

type ClientMock = {
  getAccount: jest.Mock;
  getNetworkPassphrase: jest.Mock;
  simulate: jest.Mock;
  prepareTransaction: jest.Mock;
  sendAndConfirm: jest.Mock;
};

type AbiMock = {
  validateAndBuildArgs: jest.Mock;
};

function createClientMock(): ClientMock {
  return {
    getAccount: jest.fn(async () => {
      return new Account(SOURCE_KP.publicKey(), '100');
    }),
    getNetworkPassphrase: jest.fn(() => PASSPHRASE),
    simulate: jest.fn(async () => ({ minResourceFee: '1500' })),
    prepareTransaction: jest.fn(async (tx: Transaction) => tx),
    sendAndConfirm: jest.fn(async () => ({ txHash: 'confirmed-hash' })),
  };
}

function createAbiMock(): AbiMock {
  return {
    validateAndBuildArgs: jest.fn(() => []),
  };
}

/** Produces a base64 *raw* signature as TransactionBuilder.addSignature expects. */
function rawSignature(kp: Keypair, xdr: string): string {
  const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE) as Transaction;
  return kp.sign(tx.hash()).toString('base64');
}

function parseSigs(xdr: string): Transaction {
  const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE) as Transaction;
  return tx;
}

describe('MultisigTransactionBuilder', () => {
  let builder: MultisigTransactionBuilder;
  let client: ClientMock;
  let abi: AbiMock;

  beforeEach(() => {
    client = createClientMock();
    abi = createAbiMock();
    builder = new MultisigTransactionBuilder(
      client as never,
      abi as never,
    );
  });

  const thresholdConfig = (threshold: number): MultisigConfig => ({
    threshold,
    signers: [
      { publicKey: SIGNER_1.publicKey(), signed: false, weight: 1 },
      { publicKey: SIGNER_2.publicKey(), signed: false, weight: 1 },
      { publicKey: SIGNER_3.publicKey(), signed: false, weight: 1 },
    ],
    timeout: 600,
  });

  const swapInvocation = (): BatchedInvocation => ({
    contractId: CONTRACT_ID,
    method: 'swap',
    args: {},
  });

  describe('buildTransaction', () => {
    it('prepares the transaction before any signature is collected', async () => {
      const tx = await builder.buildTransaction(
        [swapInvocation()],
        thresholdConfig(2),
        SOURCE_KP.publicKey(),
      );

      expect(client.prepareTransaction).toHaveBeenCalledTimes(1);

      const parsed = parseSigs(tx.transactionXdr);
      expect(parsed.signatures).toHaveLength(0);
    });

    it('returns the gas estimate from the simulation', async () => {
      const tx = await builder.buildTransaction(
        [swapInvocation()],
        thresholdConfig(2),
        SOURCE_KP.publicKey(),
      );
      expect(tx.estimatedGas.minResourceFee).toBe('1500');
    });

    it('rejects batches above the Stellar 100-operation limit with a clear error', async () => {
      const tooMany = Array.from({ length: 101 }, () => swapInvocation());
      await expect(
        builder.buildTransaction(
          tooMany,
          thresholdConfig(2),
          SOURCE_KP.publicKey(),
        ),
      ).rejects.toBeInstanceOf(SorobanApplicationError);
      await expect(
        builder.buildTransaction(
          tooMany,
          thresholdConfig(2),
          SOURCE_KP.publicKey(),
        ),
      ).rejects.toThrow(/100/);
    });
  });

  describe('addSignature', () => {
    it('collects 2-of-3 signatures and the final XDR contains both', async () => {
      const tx: MultisigTransaction = await builder.buildTransaction(
        [swapInvocation()],
        thresholdConfig(2),
        SOURCE_KP.publicKey(),
      );

      const sig1 = rawSignature(SIGNER_1, tx.transactionXdr);
      builder.addSignature(tx, SIGNER_1.publicKey(), sig1);

      const afterFirst = parseSigs(tx.transactionXdr);
      expect(afterFirst.signatures).toHaveLength(1);
      expect(tx.currentWeight).toBe(1);
      expect(tx.isReadyToSubmit).toBe(false);

      // The regenerated envelope carries signer 1, so signer 2 signs the
      // *updated* envelope.
      const sig2 = rawSignature(SIGNER_2, tx.transactionXdr);
      builder.addSignature(tx, SIGNER_2.publicKey(), sig2);

      const final = parseSigs(tx.transactionXdr);
      expect(final.signatures).toHaveLength(2);
      expect(final.signatures[0].signature().toString('base64')).toBe(sig1);
      expect(final.signatures[1].signature().toString('base64')).toBe(sig2);
      expect(tx.currentWeight).toBe(2);
      expect(tx.isReadyToSubmit).toBe(true);
      expect(
        tx.signers.filter((s) => s.signed).map((s) => s.publicKey),
      ).toEqual([SIGNER_1.publicKey(), SIGNER_2.publicKey()]);
    });

    it('mutates in place and returns the same object reference', async () => {
      const tx = await builder.buildTransaction(
        [swapInvocation()],
        thresholdConfig(2),
        SOURCE_KP.publicKey(),
      );

      const returned = builder.addSignature(
        tx,
        SIGNER_1.publicKey(),
        rawSignature(SIGNER_1, tx.transactionXdr),
      );

      // The caller may ignore the return value: state is visible on the input.
      expect(returned).toBe(tx);
      expect(tx.currentWeight).toBe(1);
      expect(tx.signers[0].signed).toBe(true);
    });

    it('rejects unknown signers and duplicate signatures', async () => {
      const tx = await builder.buildTransaction(
        [swapInvocation()],
        thresholdConfig(2),
        SOURCE_KP.publicKey(),
      );

      expect(() =>
        builder.addSignature(tx, Keypair.random().publicKey(), 'zzz'),
      ).toThrow(SorobanApplicationError);

      const sig = rawSignature(SIGNER_1, tx.transactionXdr);
      builder.addSignature(tx, SIGNER_1.publicKey(), sig);

      expect(() =>
        builder.addSignature(tx, SIGNER_1.publicKey(), sig),
      ).toThrow(SorobanApplicationError);
    });
  });

  describe('submitTransaction', () => {
    it('never re-prepares after signatures were collected', async () => {
      const tx = await builder.buildTransaction(
        [swapInvocation()],
        thresholdConfig(2),
        SOURCE_KP.publicKey(),
      );

      builder.addSignature(
        tx,
        SIGNER_1.publicKey(),
        rawSignature(SIGNER_1, tx.transactionXdr),
      );
      builder.addSignature(
        tx,
        SIGNER_2.publicKey(),
        rawSignature(SIGNER_2, tx.transactionXdr),
      );

      const confirmed = await builder.submitTransaction(tx);

      // Exactly one preparation â€” the one from buildTransaction, executed
      // before the first signature. Re-running it now would invalidate the
      // collected signatures.
      expect(client.prepareTransaction).toHaveBeenCalledTimes(1);
      expect(client.sendAndConfirm).toHaveBeenCalledTimes(1);
      expect(client.sendAndConfirm).toHaveBeenCalledWith(tx.transaction);
      expect((confirmed as { txHash: string }).txHash).toBe('confirmed-hash');
    });

    it('refuses to submit below the threshold', async () => {
      const tx = await builder.buildTransaction(
        [swapInvocation()],
        thresholdConfig(2),
        SOURCE_KP.publicKey(),
      );

      await expect(builder.submitTransaction(tx)).rejects.toBeInstanceOf(
        SorobanApplicationError,
      );
      expect(client.sendAndConfirm).not.toHaveBeenCalled();
    });
  });
});
