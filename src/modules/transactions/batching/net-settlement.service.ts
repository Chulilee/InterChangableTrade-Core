import { Injectable } from '@nestjs/common';
import { Transaction } from '../entities/transaction.entity';
import { FeeAnalysis, NetTransfer } from './entities/settlement-batch.entity';

/** Flat Stellar fee per transaction, in stroops (100 stroops = 0.00001 XLM). */
export const BASE_FEE_STROOPS = 100;

interface Balance {
  account: string;
  net: number;
}

/**
 * Pure settlement math used by the batching service. Kept free of I/O so the
 * netting algorithm can be exhaustively unit-tested.
 */
@Injectable()
export class NetSettlementService {
  /**
   * Reduces a list of pending transactions to the minimal set of payments.
   *
   * Transactions are grouped per asset (code + issuer). Within an asset every
   * account's flows are summed into one net balance; the algorithm then
   * matches the biggest debtor against the biggest creditor until all
   * balances cancel out. Accounts whose flows cancel completely drop out,
   * which is where the bulk of the savings come from.
   */
  computeNetSettlement(transactions: Transaction[]): NetTransfer[] {
    const balancesByAsset = new Map<
      string,
      {
        assetCode: string;
        assetIssuer: string | null;
        accounts: Map<string, number>;
      }
    >();

    for (const tx of transactions) {
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (!tx.fromAccount || !tx.toAccount) continue;

      const key = `${tx.assetCode}::${tx.assetIssuer ?? ''}`;
      let group = balancesByAsset.get(key);
      if (!group) {
        group = {
          assetCode: tx.assetCode,
          assetIssuer: tx.assetIssuer ?? null,
          accounts: new Map<string, number>(),
        };
        balancesByAsset.set(key, group);
      }

      // Use full precision decimal math on scaled integers (7 decimals like
      // Stellar) to avoid float drift when summing many flows.
      const scaled = Math.round(amount * 1e7);
      group.accounts.set(
        tx.fromAccount,
        (group.accounts.get(tx.fromAccount) ?? 0) - scaled,
      );
      group.accounts.set(
        tx.toAccount,
        (group.accounts.get(tx.toAccount) ?? 0) + scaled,
      );
    }

    const transfers: NetTransfer[] = [];
    for (const group of balancesByAsset.values()) {
      transfers.push(
        ...this.netAssetGroup(group.assetCode, group.assetIssuer, [
          ...group.accounts.entries(),
        ]),
      );
    }
    return transfers;
  }

  private netAssetGroup(
    assetCode: string,
    assetIssuer: string | null,
    entries: [string, number][],
  ): NetTransfer[] {
    const balances: Balance[] = entries
      .map(([account, net]) => ({ account, net }))
      .filter((b) => b.net !== 0);

    const transfers: NetTransfer[] = [];
    // Greedy matching: repeatedly settle the largest creditor with the
    // largest debtor. Produces at most (n-1) transfers per asset and exactly
    // cancels every balance.
    balances.sort((a, b) => b.net - a.net);

    let lo = balances.length - 1;
    for (let hi = 0; hi < lo;) {
      const creditor = balances[hi];
      const debtor = balances[lo];
      const settled = Math.min(creditor.net, -debtor.net);

      transfers.push({
        fromAccount: debtor.account,
        toAccount: creditor.account,
        assetCode,
        assetIssuer,
        amount: this.formatAmount(settled),
      });

      creditor.net -= settled;
      debtor.net += settled;

      if (creditor.net === 0) hi++;
      if (debtor.net === 0) lo--;
    }
    return transfers;
  }

  /** Formats scaled integer stroop-style amounts back to 7-decimal strings. */
  formatAmount(scaled: number): string {
    const negative = scaled < 0;
    const abs = Math.abs(scaled);
    const units = Math.floor(abs / 1e7);
    const fraction = String(abs % 1e7)
      .padStart(7, '0')
      .replace(/0+$/, '');
    return `${negative ? '-' : ''}${units}${fraction ? '.' + fraction : ''}`;
  }

  /**
   * Fee comparison between settling every member transaction individually
   * versus submitting only the net transfers. Each on-chain transaction costs
   * BASE_FEE_STROOPS regardless of how it was produced.
   */
  analyzeFees(individualCount: number, transfers: NetTransfer[]): FeeAnalysis {
    const feeBefore = individualCount * BASE_FEE_STROOPS;
    const feeAfter = transfers.length * BASE_FEE_STROOPS;
    const savingsPercent =
      feeBefore === 0 ? 0 : ((feeBefore - feeAfter) / feeBefore) * 100;
    return {
      individualTransactions: individualCount,
      batchedTransactions: transfers.length,
      feeBeforeStroops: String(feeBefore),
      feeAfterStroops: String(feeAfter),
      savingsPercent: savingsPercent.toFixed(2),
    };
  }

  /**
   * Composition validation: returns the subset of transactions eligible for
   * batching plus the rejected ones with reasons.
   */
  validateComposition(transactions: Transaction[]): {
    eligible: Transaction[];
    rejected: Array<{ transactionId: string; reason: string }>;
  } {
    const eligible: Transaction[] = [];
    const rejected: Array<{ transactionId: string; reason: string }> = [];

    for (const tx of transactions) {
      if (!tx.fromAccount || !tx.toAccount) {
        rejected.push({
          transactionId: tx.id,
          reason: 'missing from/to account',
        });
      } else if (!(Number(tx.amount) > 0)) {
        rejected.push({ transactionId: tx.id, reason: 'non-positive amount' });
      } else if (tx.status !== 'pending') {
        rejected.push({ transactionId: tx.id, reason: 'not pending' });
      } else {
        eligible.push(tx);
      }
    }
    return { eligible, rejected };
  }
}
