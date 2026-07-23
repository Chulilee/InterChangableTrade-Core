import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { AuthAuditService } from './auth-audit.service';
import { AuthEventType } from './entities/auth-audit-log.entity';
import { AuthRateLimiterService } from './auth-rate-limiter.service';
import { StellarAuthService } from './stellar-auth.service';
import { User } from '../users/entities/user.entity';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
  deviceHint?: string;
}

const REFRESH_TOKEN_BYTES = 32;
const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuthAuditService,
    private readonly rateLimiter: AuthRateLimiterService,
    private readonly stellarAuth: StellarAuthService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokenRepo: Repository<PasswordResetToken>,
  ) {}

  // --------------------------------------------------------------------------
  // Registration & Email/Password Login
  // --------------------------------------------------------------------------

  async register(
    dto: RegisterDto,
    ctx: RequestContext,
  ): Promise<AuthResult> {
    const user = await this.usersService.create(dto);

    await this.auditService.recordSuccess(AuthEventType.REGISTER, {
      userId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.issueTokenPair(user, ctx);
  }

  async login(dto: LoginDto, ctx: RequestContext): Promise<AuthResult> {
    // Check rate limit first.
    const lockedOut = await this.rateLimiter.isLockedOut(dto.email);
    if (lockedOut) {
      const ttl = await this.rateLimiter.getLockoutTtl(dto.email);
      await this.auditService.recordFailure(
        AuthEventType.LOGIN_FAILED,
        {
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          metadata: { email: dto.email },
        },
        `Account locked out, retry in ${ttl}s`,
      );
      throw new UnauthorizedException(
        `Too many failed attempts. Try again in ${ttl} seconds.`,
      );
    }

    const user = await this.usersService.findByEmailWithSecret(dto.email);
    if (!user || !user.isActive) {
      await this.rateLimiter.recordFailure(dto.email);
      await this.auditService.recordFailure(
        AuthEventType.LOGIN_FAILED,
        { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
        'Invalid credentials',
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      await this.rateLimiter.recordFailure(dto.email);
      await this.auditService.recordFailure(
        AuthEventType.LOGIN_FAILED,
        {
          userId: user.id,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        'Invalid credentials',
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    // Success — clear any prior failures.
    await this.rateLimiter.clearFailures(dto.email);
    await this.auditService.recordSuccess(AuthEventType.LOGIN_SUCCESS, {
      userId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.issueTokenPair(user, ctx);
  }

  // --------------------------------------------------------------------------
  // Stellar Wallet Authentication
  // --------------------------------------------------------------------------

  async stellarChallenge(
    publicKey: string,
    ctx: RequestContext,
  ): Promise<{ nonce: string; expiresAt: Date }> {
    await this.auditService.recordSuccess(AuthEventType.STELLAR_AUTH_CHALLENGE, {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { publicKey },
    });

    return this.stellarAuth.createChallenge(publicKey);
  }

  async stellarVerify(
    nonce: string,
    publicKey: string,
    signature: string,
    ctx: RequestContext,
  ): Promise<AuthResult> {
    try {
      await this.stellarAuth.verifyChallenge(nonce, publicKey, signature);
    } catch (err) {
      await this.auditService.recordFailure(
        AuthEventType.STELLAR_AUTH_FAILED,
        {
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          metadata: { publicKey },
        },
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }

    // Find or create user with this Stellar key.
    let user = await this.usersService.findByStellarPublicKey(publicKey);
    if (!user) {
      user = await this.usersService.createFromStellarKey(publicKey);
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    await this.auditService.recordSuccess(AuthEventType.STELLAR_AUTH_SUCCESS, {
      userId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { publicKey },
    });

    return this.issueTokenPair(user, ctx);
  }

  // --------------------------------------------------------------------------
  // Token Refresh & Logout
  // --------------------------------------------------------------------------

  async refreshAccessToken(
    rawRefreshToken: string,
    ctx: RequestContext,
  ): Promise<AuthResult> {
    const tokenRecord = await this.refreshTokenRepo
      .createQueryBuilder('rt')
      .addSelect('rt.tokenHash')
      .leftJoinAndSelect('rt.user', 'user')
      .where('rt.isRevoked = false')
      .andWhere('rt.expiresAt > NOW()')
      .getMany();

    let match: RefreshToken | null = null;
    for (const candidate of tokenRecord) {
      const valid = await bcrypt.compare(rawRefreshToken, candidate.tokenHash);
      if (valid) {
        match = candidate;
        break;
      }
    }

    if (!match || !match.user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke the old token and issue a new pair (rotation).
    match.isRevoked = true;
    match.revokedAt = new Date();
    await this.refreshTokenRepo.save(match);

    await this.auditService.recordSuccess(AuthEventType.TOKEN_REFRESH, {
      userId: match.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.issueTokenPair(match.user, ctx);
  }

  async logout(userId: string, rawRefreshToken: string): Promise<void> {
    const tokens = await this.refreshTokenRepo
      .createQueryBuilder('rt')
      .addSelect('rt.tokenHash')
      .where('rt.userId = :userId', { userId })
      .andWhere('rt.isRevoked = false')
      .getMany();

    for (const token of tokens) {
      const matches = await bcrypt.compare(rawRefreshToken, token.tokenHash);
      if (matches) {
        token.isRevoked = true;
        token.revokedAt = new Date();
        await this.refreshTokenRepo.save(token);

        await this.auditService.recordSuccess(AuthEventType.LOGOUT, {
          userId,
        });
        return;
      }
    }

    // If the token wasn't found, still return success (idempotent logout).
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokenRepo.update(
      { userId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date() },
    );

    await this.auditService.recordSuccess(AuthEventType.LOGOUT, {
      userId,
      metadata: { logoutAll: true },
    });
  }

  // --------------------------------------------------------------------------
  // Password Reset Flow
  // --------------------------------------------------------------------------

  async requestPasswordReset(email: string, ctx: RequestContext): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // For security, always return success even if the email doesn't exist.
      return;
    }

    // Revoke any existing tokens for this user.
    await this.resetTokenRepo.update({ userId: user.id, isUsed: false }, { isUsed: true });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + 3600_000); // 1 hour

    const resetToken = this.resetTokenRepo.create({
      userId: user.id,
      tokenHash,
      expiresAt,
    });
    await this.resetTokenRepo.save(resetToken);

    await this.auditService.recordSuccess(
      AuthEventType.PASSWORD_RESET_REQUEST,
      {
        userId: user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    );

    // TODO: Send `rawToken` via email (requires NotificationsModule integration).
    // For now, log it (dev-only).
    console.log(`Password reset token for ${email}: ${rawToken}`);
  }

  async confirmPasswordReset(
    rawToken: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<void> {
    const candidates = await this.resetTokenRepo
      .createQueryBuilder('rt')
      .addSelect('rt.tokenHash')
      .leftJoinAndSelect('rt.user', 'user')
      .where('rt.isUsed = false')
      .andWhere('rt.expiresAt > NOW()')
      .getMany();

    let match: PasswordResetToken | null = null;
    for (const candidate of candidates) {
      const valid = await bcrypt.compare(rawToken, candidate.tokenHash);
      if (valid) {
        match = candidate;
        break;
      }
    }

    if (!match || !match.user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Update password (hash it first).
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.usersService.updatePassword(match.userId, passwordHash);

    // Mark token as used.
    match.isUsed = true;
    await this.resetTokenRepo.save(match);

    // Revoke all refresh tokens to force re-login.
    await this.logoutAll(match.userId);

    await this.auditService.recordSuccess(
      AuthEventType.PASSWORD_RESET_SUCCESS,
      {
        userId: match.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    );
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private async issueTokenPair(
    user: User,
    ctx: RequestContext,
  ): Promise<AuthResult> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    const rawRefreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const tokenHash = await bcrypt.hash(rawRefreshToken, BCRYPT_ROUNDS);

    const refreshTokenTtlSecs = parseInt(
      this.configService.get<string>('jwt.refreshExpiresIn') ?? '2592000',
      10,
    );
    const expiresAt = new Date(Date.now() + refreshTokenTtlSecs * 1000);

    const refreshToken = this.refreshTokenRepo.create({
      userId: user.id,
      tokenHash,
      deviceHint: ctx.deviceHint,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      expiresAt,
    });
    await this.refreshTokenRepo.save(refreshToken);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }
}
