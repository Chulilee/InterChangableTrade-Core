import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Account, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  AccountSignerEntry,
  AccountSignersSummary,
  StellarService,
} from '../../stellar/stellar.service';
import { WalletService } from '../wallet.service';
import { AuthenticatedUser } from '../../auth/decorators/current-user.decorator';
import { EnableMultisigDto } from '../dto/enable-multisig.dto';
import { RotateKeyDto } from '../dto/rotate-key.dto';
import {
  DEFAULT_MULTISIG_TX_TIMEOUT_SECS,
  MAX_SIGNERS,
} from '../constants/multisig.constants';

/** Per-operation base fee, in stroops. */
const BASE_FEE = '100';

export interface UnsignedTxResponse {
  /** Base64 XDR of the unsigned transaction, to feed into the pipeline. */
  unsignedXdr: string;
  /** Human-readable description of the change the transaction applies. */
  summary: string;
}

/**
 * Manages the on-chain configuration of a wallet's native multisig: reading the
 * current signer set/thresholds and building the `SetOptions` transactions that
 * enable M-of-N or rotate a key. It never signs — every transaction it produces
 * flows through {@link MultisigTransactionService} to be signed and broadcast.
 */
@Injectable()
export class MultisigAccountService {
  private readonly logger = new Logger(MultisigAccountService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly stellarService: StellarService,
  ) {}

  /**
   * Returns the account's live signer set, thresholds, and master-key weight.
   * Verifies the caller owns the wallet first.
   */
  async getOnChainConfig(
    walletId: string,
    user: AuthenticatedUser,
  ): Promise<AccountSignersSummary> {
    const wallet = await this.walletService.findOne(walletId, user.id);
    return this.stellarService.getAccountSigners(wallet.publicKey);
  }

  /**
   * Builds an unsigned `SetOptions` transaction that adds the requested signers
   * and sets the master weight / operation thresholds — turning the account
   * into an M-of-N multisig. Validates the 20-signer cap and that thresholds
   * remain satisfiable.
   */
  async buildEnableMultisigTx(
    walletId: string,
    user: AuthenticatedUser,
    dto: EnableMultisigDto,
  ): Promise<UnsignedTxResponse> {
    const wallet = await this.walletService.findOne(walletId, user.id);

    // The master key is controlled via masterWeight, not as an added signer.
    if (dto.signers.some((s) => s.publicKey === wallet.publicKey)) {
      throw new BadRequestException(
        'The account key cannot be added as a signer of itself; use masterWeight instead',
      );
    }

    const current = await this.stellarService.getAccountSigners(
      wallet.publicKey,
    );

    // Work out the resulting signer set to enforce the on-chain 20-signer cap
    // and to check thresholds against the total achievable weight.
    const resulting = this.computeResultingSigners(
      current.signers,
      current.accountId,
      dto.signers,
    );
    if (resulting.size > MAX_SIGNERS) {
      throw new BadRequestException(
        `Resulting signer count (${resulting.size}) exceeds the Stellar limit of ${MAX_SIGNERS}`,
      );
    }

    const effectiveMaster = dto.masterWeight ?? current.masterWeight;
    const totalWeight =
      effectiveMaster + [...resulting.values()].reduce((sum, w) => sum + w, 0);

    if (totalWeight < 1) {
      throw new BadRequestException(
        'Resulting configuration has zero total signing weight and would lock the account',
      );
    }
    this.assertThresholdSatisfiable('low', dto.lowThreshold, totalWeight);
    this.assertThresholdSatisfiable('medium', dto.medThreshold, totalWeight);
    this.assertThresholdSatisfiable('high', dto.highThreshold, totalWeight);

    const account = await this.loadSourceAccount(wallet.publicKey);
    const passphrase = this.stellarService.getNetworkInfo().passphrase;
    const builder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    });

    // A single SetOptions op carries the threshold / master-weight changes; each
    // additional signer needs its own op (Stellar sets one signer per op).
    const thresholdOp: Parameters<typeof Operation.setOptions>[0] = {};
    if (dto.masterWeight !== undefined)
      thresholdOp.masterWeight = dto.masterWeight;
    if (dto.lowThreshold !== undefined)
      thresholdOp.lowThreshold = dto.lowThreshold;
    if (dto.medThreshold !== undefined)
      thresholdOp.medThreshold = dto.medThreshold;
    if (dto.highThreshold !== undefined)
      thresholdOp.highThreshold = dto.highThreshold;
    if (Object.keys(thresholdOp).length > 0) {
      builder.addOperation(Operation.setOptions(thresholdOp));
    }

    for (const signer of dto.signers) {
      builder.addOperation(
        Operation.setOptions({
          signer: {
            ed25519PublicKey: signer.publicKey,
            weight: signer.weight,
          },
        }),
      );
    }

    const transaction = builder
      .setTimeout(DEFAULT_MULTISIG_TX_TIMEOUT_SECS)
      .build();

    const summary = `Enable multisig: ${dto.signers.length} signer(s), thresholds L/M/H = ${
      dto.lowThreshold ?? current.thresholds.low
    }/${dto.medThreshold ?? current.thresholds.med}/${
      dto.highThreshold ?? current.thresholds.high
    }`;

    this.logger.log(
      `Built enable-multisig tx for wallet ${walletId}: ${summary}`,
    );
    return { unsignedXdr: transaction.toXDR(), summary };
  }

  /**
   * Builds an unsigned `SetOptions` transaction that rotates one signer key for
   * another in a single atomic transaction — the new key is added and the old
   * removed. The account ID is unchanged, so this is rotation without
   * migration. Defaults the new signer's weight to the outgoing signer's.
   */
  async buildRotateKeyTx(
    walletId: string,
    user: AuthenticatedUser,
    dto: RotateKeyDto,
  ): Promise<UnsignedTxResponse> {
    const wallet = await this.walletService.findOne(walletId, user.id);
    const current = await this.stellarService.getAccountSigners(
      wallet.publicKey,
    );

    if (dto.oldSignerPublicKey === current.accountId) {
      throw new BadRequestException(
        'The master key cannot be rotated through this endpoint; use enable-multisig with masterWeight',
      );
    }
    const outgoing = current.signers.find(
      (s) => s.key === dto.oldSignerPublicKey,
    );
    if (!outgoing) {
      throw new BadRequestException(
        `${dto.oldSignerPublicKey} is not a signer on this account`,
      );
    }
    if (dto.newSignerPublicKey === dto.oldSignerPublicKey) {
      throw new BadRequestException(
        'The new signer must differ from the old signer',
      );
    }
    if (current.signers.some((s) => s.key === dto.newSignerPublicKey)) {
      throw new ConflictException(
        `${dto.newSignerPublicKey} is already a signer on this account`,
      );
    }

    const weight = dto.weight ?? outgoing.weight;

    const account = await this.loadSourceAccount(wallet.publicKey);
    const passphrase = this.stellarService.getNetworkInfo().passphrase;
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      // Add the new signer before removing the old so authority is never
      // reduced below the threshold mid-transaction.
      .addOperation(
        Operation.setOptions({
          signer: { ed25519PublicKey: dto.newSignerPublicKey, weight },
        }),
      )
      .addOperation(
        Operation.setOptions({
          signer: { ed25519PublicKey: dto.oldSignerPublicKey, weight: 0 },
        }),
      )
      .setTimeout(DEFAULT_MULTISIG_TX_TIMEOUT_SECS)
      .build();

    const summary = `Rotate signer ${dto.oldSignerPublicKey} → ${dto.newSignerPublicKey} (weight ${weight})`;
    this.logger.log(`Built rotate-key tx for wallet ${walletId}: ${summary}`);
    return { unsignedXdr: transaction.toXDR(), summary };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Loads the source account so the SDK can read its current sequence number.
   * The builder increments it, producing the next valid sequence.
   */
  private async loadSourceAccount(publicKey: string): Promise<Account> {
    const summary = await this.stellarService.getAccount(publicKey);
    return new Account(publicKey, summary.sequence);
  }

  /**
   * Projects the account's additional-signer set after applying the requested
   * changes (weight 0 removes a signer). Excludes the master key, which is
   * governed by masterWeight rather than counted against the signer limit.
   */
  private computeResultingSigners(
    existing: AccountSignerEntry[],
    accountId: string,
    additions: { publicKey: string; weight: number }[],
  ): Map<string, number> {
    const map = new Map<string, number>();
    for (const s of existing) {
      if (s.key === accountId) continue;
      if (s.weight > 0) map.set(s.key, s.weight);
    }
    for (const a of additions) {
      if (a.weight > 0) map.set(a.publicKey, a.weight);
      else map.delete(a.publicKey);
    }
    return map;
  }

  private assertThresholdSatisfiable(
    label: string,
    threshold: number | undefined,
    totalWeight: number,
  ): void {
    if (threshold !== undefined && threshold > totalWeight) {
      throw new BadRequestException(
        `${label} threshold (${threshold}) exceeds the total available signing weight (${totalWeight}); the account would be unusable`,
      );
    }
  }
}
