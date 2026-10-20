import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { AuthorizationAuditEntry } from '../interfaces/authorization.types';

export interface RecordAuditInput {
  actorId: string;
  action: string;
  subjectId?: string;
  decision: 'allow' | 'deny';
  reason: string;
  metadata?: Record<string, unknown>;
}

const GENESIS_HASH = '0'.repeat(64);

/**
 * Append-only, hash-chained audit trail for every authorisation decision and
 * permission change.
 *
 * Each entry commits to the previous entry's hash, so any tampering with
 * history invalidates every subsequent hash. `verifyChain()` detects that.
 */
@Injectable()
export class AuthorizationAuditService {
  private readonly logger = new Logger(AuthorizationAuditService.name);
  private readonly entries: AuthorizationAuditEntry[] = [];

  record(input: RecordAuditInput): AuthorizationAuditEntry {
    const previousHash =
      this.entries.length > 0
        ? this.entries[this.entries.length - 1].hash
        : GENESIS_HASH;
    const sequence = this.entries.length + 1;
    const timestamp = new Date();

    const hash = AuthorizationAuditService.computeHash(
      previousHash,
      sequence,
      input,
      timestamp,
    );

    const entry: AuthorizationAuditEntry = {
      id: randomUUID(),
      sequence,
      timestamp,
      actorId: input.actorId,
      action: input.action,
      subjectId: input.subjectId,
      decision: input.decision,
      reason: input.reason,
      metadata: input.metadata ?? {},
      previousHash,
      hash,
    };

    this.entries.push(entry);
    this.logger.debug(
      `Audit entry ${sequence} recorded: ${input.action} -> ${input.decision}`,
    );
    return entry;
  }

  /** All audit entries, oldest first. */
  list(): AuthorizationAuditEntry[] {
    return [...this.entries];
  }

  /** Entries recorded for a specific subject. */
  listForSubject(subjectId: string): AuthorizationAuditEntry[] {
    return this.entries.filter((entry) => entry.subjectId === subjectId);
  }

  /** Recomputes the chain and reports whether it is intact. */
  verifyChain(): boolean {
    let previousHash = GENESIS_HASH;
    for (const entry of this.entries) {
      if (entry.previousHash !== previousHash) return false;
      const expected = AuthorizationAuditService.computeHash(
        entry.previousHash,
        entry.sequence,
        {
          actorId: entry.actorId,
          action: entry.action,
          subjectId: entry.subjectId,
          decision: entry.decision,
          reason: entry.reason,
          metadata: entry.metadata,
        },
        entry.timestamp,
      );
      if (expected !== entry.hash) return false;
      previousHash = entry.hash;
    }
    return true;
  }

  private static computeHash(
    previousHash: string,
    sequence: number,
    input: RecordAuditInput,
    timestamp: Date,
  ): string {
    const payload = [
      previousHash,
      sequence,
      input.actorId,
      input.action,
      input.subjectId ?? '',
      input.decision,
      input.reason,
      timestamp.toISOString(),
      JSON.stringify(input.metadata ?? {}),
    ].join('|');
    return createHash('sha256').update(payload).digest('hex');
  }
}
