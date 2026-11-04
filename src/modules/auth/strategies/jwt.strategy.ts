import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /** Present on narrowly-scoped step-up tokens; never a valid access token. */
  purpose?: string;
}

/**
 * Validates the bearer token signature/expiry, then confirms the user still
 * exists and is active. The returned value is attached to `request.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload) {
    // A step-up token is scoped to one class of sensitive operation. It must
    // never be accepted as a general bearer credential for the API.
    if (payload.purpose) {
      throw new UnauthorizedException('Not a valid access token');
    }

    const user = await this.usersService.findOne(payload.sub).catch(() => null);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is inactive or missing');
    }
    return { id: user.id, email: user.email, role: user.role };
  }
}
