import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';

/** Scope claim required on tokens used for high-risk wallet operations. */
export const STEP_UP_SCOPE = 'wallet:high-risk';

/** Marker that distinguishes a step-up token from an access token. */
export const STEP_UP_PURPOSE = 'wallet-step-up';

/** Default lifetime for a step-up token: five minutes. */
export const DEFAULT_STEP_UP_TTL_SECONDS = 300;

export interface StepUpTokenPayload {
  sub: string;
  purpose: typeof STEP_UP_PURPOSE;
  scope: string;
}

export interface IssuedStepUpToken {
  stepUpToken: string;
  expiresAt: Date;
}

/**
 * Issues and verifies short-lived, narrowly-scoped tokens that authorise a
 * single class of sensitive action (currently high-risk wallet signing).
 *
 * A step-up token is deliberately not interchangeable with an access token:
 * it carries a `purpose` marker that `JwtStrategy` rejects, and it is only
 * minted by exchanging a valid refresh token at `/auth/step-up`. A stolen
 * access token alone can therefore not authorise `setOptions` or
 * `accountMerge`.
 */
@Injectable()
export class StepUpTokenService {
  constructor(private readonly jwtService: JwtService) {}

  issue(
    userId: string,
    ttlSeconds: number = DEFAULT_STEP_UP_TTL_SECONDS,
  ): IssuedStepUpToken {
    const payload: StepUpTokenPayload = {
      sub: userId,
      purpose: STEP_UP_PURPOSE,
      scope: STEP_UP_SCOPE,
    };

    const stepUpToken = this.jwtService.sign(payload, {
      expiresIn: ttlSeconds,
      jwtid: randomUUID(),
    });

    return {
      stepUpToken,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  /**
   * Verifies that `token` is a live step-up token issued to `userId`.
   * Throws `UnauthorizedException` for a missing, malformed, expired or
   * wrong-subject token.
   */
  verify(token: string | undefined, userId: string): void {
    if (!token) {
      throw new UnauthorizedException(
        'Step-up authentication required for this operation',
      );
    }

    let payload: StepUpTokenPayload;
    try {
      payload = this.jwtService.verify<StepUpTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired step-up token');
    }

    if (
      payload.purpose !== STEP_UP_PURPOSE ||
      payload.scope !== STEP_UP_SCOPE ||
      payload.sub !== userId
    ) {
      throw new UnauthorizedException('Invalid step-up token');
    }
  }
}
