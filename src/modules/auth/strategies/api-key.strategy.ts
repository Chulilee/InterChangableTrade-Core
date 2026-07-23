import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { Request } from 'express';
import { ApiKeysService } from '../api-keys.service';
import { ConfigService } from '@nestjs/config';

export const API_KEY_STRATEGY = 'api-key';
const API_KEY_HEADER = 'x-api-key';

/**
 * A lightweight custom Passport strategy that reads the `X-Api-Key` header
 * and validates it via `ApiKeysService`.
 *
 * Extends the base Strategy class directly rather than relying on
 * `passport-custom` (which is not a declared dependency).
 */
@Injectable()
export class ApiKeyStrategy {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  /**
   * Validates the raw API key from the request header.
   * Called directly by `ApiKeyAuthGuard.canActivate`.
   */
  async validate(req: Request) {
    const rawKey = req.headers[API_KEY_HEADER] as string | undefined;
    if (!rawKey) {
      throw new UnauthorizedException('Missing X-Api-Key header');
    }

    const apiKey = await this.apiKeysService.validate(rawKey);
    const { user } = apiKey;

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Associated account is inactive');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      apiKeyId: apiKey.id,
      scopes: apiKey.scopes ?? [],
    };
  }
}
