import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyStrategy } from '../strategies/api-key.strategy';

/**
 * Route guard that validates the `X-Api-Key` header and attaches the
 * associated user to `request.user`.
 * Apply with `@UseGuards(ApiKeyAuthGuard)`.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly apiKeyStrategy: ApiKeyStrategy) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = await this.apiKeyStrategy.validate(request);
    request.user = user;
    return true;
  }
}
