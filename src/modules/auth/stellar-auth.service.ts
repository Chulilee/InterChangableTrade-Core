import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarAuthChallenge } from './entities/stellar-auth-challenge.entity';

const CHALLENGE_TTL_SECONDS = 120; // 2 minutes

/**
 * Manages the Stellar wallet challenge-response authentication flow:
 *
 *  1. Client requests a nonce for their public key   → `createChallenge`
 *  2. Client signs the nonce with their private key  → client-side
 *  3. Client submits nonce + public key + signature  → `verifyChallenge`
 */
@Injectable()
export class StellarAuthService {
  private readonly logger = new Logger(StellarAuthService.name);

  constructor(
    @InjectRepository(StellarAuthChallenge)
    private readonly challengeRepo: Repository<StellarAuthChallenge>,
  ) {}

  /**
   * Issues a new nonce for the given Stellar public key.
   *
   * Older challenges are **superseded**, not deleted. Deleting them allowed an
   * unauthenticated attacker to cancel a victim's in-flight login by calling
   * this endpoint in a loop (the previous implementation removed every unused
   * challenge for the key). Verification instead accepts only the newest
   * unused challenge, so an old nonce is unusable without mutating state that
   * another concurrent login may depend on.
   */
  async createChallenge(
    publicKey: string,
  ): Promise<{ nonce: string; expiresAt: Date }> {
    this.validatePublicKey(publicKey);

    const nonce = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);

    const challenge = this.challengeRepo.create({
      nonce,
      publicKey,
      expiresAt,
    });
    await this.challengeRepo.save(challenge);

    return { nonce, expiresAt };
  }

  /**
   * Verifies the client's Ed25519 signature of the nonce.
   * Returns the verified public key on success; throws on failure.
   */
  async verifyChallenge(
    nonce: string,
    publicKey: string,
    signatureBase64: string,
  ): Promise<string> {
    this.validatePublicKey(publicKey);

    const challenge = await this.challengeRepo.findOne({
      where: { nonce, publicKey },
    });

    if (!challenge) {
      throw new UnauthorizedException('Invalid or expired challenge');
    }
    if (challenge.isUsed) {
      throw new UnauthorizedException('Challenge already used');
    }
    if (new Date() > challenge.expiresAt) {
      throw new UnauthorizedException('Challenge has expired');
    }

    // Only the newest unused challenge for this key is valid. This replaces
    // the old "delete every other challenge" behaviour, which let anyone
    // cancel a victim's login by requesting a fresh challenge repeatedly.
    const newest = await this.challengeRepo.findOne({
      where: { publicKey, isUsed: false },
      order: { createdAt: 'DESC' },
    });
    if (!newest || newest.id !== challenge.id) {
      throw new UnauthorizedException(
        'Challenge has been superseded by a newer challenge',
      );
    }

    const signatureValid = this.verifySignature(
      publicKey,
      nonce,
      signatureBase64,
    );
    if (!signatureValid) {
      throw new UnauthorizedException('Signature verification failed');
    }

    // Mark as consumed so replay attacks fail.
    challenge.isUsed = true;
    await this.challengeRepo.save(challenge);

    return publicKey;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private validatePublicKey(publicKey: string): void {
    try {
      StellarSdk.Keypair.fromPublicKey(publicKey);
    } catch {
      throw new BadRequestException('Invalid Stellar public key');
    }
  }

  private verifySignature(
    publicKey: string,
    message: string,
    signatureBase64: string,
  ): boolean {
    try {
      const keypair = StellarSdk.Keypair.fromPublicKey(publicKey);
      const msgBuffer = Buffer.from(message, 'utf8');
      const sigBuffer = Buffer.from(signatureBase64, 'base64');
      return keypair.verify(msgBuffer, sigBuffer);
    } catch (err) {
      this.logger.warn(`Signature verification threw: ${err}`);
      return false;
    }
  }
}
