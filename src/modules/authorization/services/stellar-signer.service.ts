import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CollectedSignature,
  StellarSignerConfig,
} from '../interfaces/authorization.types';

export type SignatureLevel = 'low' | 'medium' | 'high';

export interface SignatureVerification {
  valid: boolean;
  weight: number;
  required: number;
  missing: number;
  level: SignatureLevel;
}

/**
 * Bridges Stellar's on-chain signer framework into the platform's
 * authorisation model.
 *
 * A Stellar multisig account carries a set of signers with weights and three
 * thresholds (low / medium / high). This service tracks those accounts and
 * answers "is this set of collected signatures sufficient?" without needing
 * to submit anything on chain.
 */
@Injectable()
export class StellarSignerService {
  private readonly logger = new Logger(StellarSignerService.name);
  private readonly accounts = new Map<string, StellarSignerConfig>();

  registerAccount(config: StellarSignerConfig): void {
    this.accounts.set(config.accountId, config);
  }

  getAccount(accountId: string): StellarSignerConfig | undefined {
    return this.accounts.get(accountId);
  }

  listAccounts(): StellarSignerConfig[] {
    return [...this.accounts.values()];
  }

  /** The on-chain weight threshold for the given level. */
  requiredWeight(accountId: string, level: SignatureLevel): number {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new BadRequestException(
        `No signer configuration registered for account ${accountId}`,
      );
    }
    switch (level) {
      case 'low':
        return account.thresholdLow;
      case 'medium':
        return account.thresholdMedium;
      case 'high':
        return account.thresholdHigh;
    }
  }

  /** Total weight of the supplied signatures, ignoring unknown signers. */
  totalWeight(
    accountId: string,
    signatures: CollectedSignature[],
  ): number {
    const account = this.accounts.get(accountId);
    if (!account) return 0;
    const weights = new Map(
      account.signers.map((signer) => [signer.key, signer.weight]),
    );
    return signatures.reduce(
      (sum, signature) => sum + (weights.get(signature.key) ?? 0),
      0,
    );
  }

  /**
   * Verifies that the collected signatures meet the threshold for the level.
   * Signatures from keys that are not configured on the account contribute
   * no weight.
   */
  verify(
    accountId: string,
    signatures: CollectedSignature[],
    level: SignatureLevel,
  ): SignatureVerification {
    const required = this.requiredWeight(accountId, level);
    const weight = this.totalWeight(accountId, signatures);
    return {
      valid: weight >= required,
      weight,
      required,
      missing: Math.max(0, required - weight),
      level,
    };
  }

  /**
   * Resolves the signature level that applies to an amount, using the
   * dynamic thresholds. Amounts at or above the base amount need the medium
   * level, and very large amounts need the high level.
   */
  levelForAmount(
    amount: number,
    baseAmount: number,
    maxAmount: number,
  ): SignatureLevel {
    if (amount >= maxAmount) return 'high';
    if (amount >= baseAmount) return 'medium';
    return 'low';
  }
}
