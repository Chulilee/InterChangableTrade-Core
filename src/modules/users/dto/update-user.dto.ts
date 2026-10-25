import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/**
 * All create fields become optional on update, except:
 *
 * - `password` — rotated through a dedicated reset flow, never a profile
 *   update.
 * - `stellarPublicKey` — the on-chain identity may only be set through the
 *   verified Stellar challenge flow. Allowing it here enabled an
 *   unauthenticated account-takeover chain (a caller could overwrite any
 *   user's public key and then mint themselves a JWT via the Stellar
 *   verify endpoint, which resolves the user by public key alone).
 *
 * `role` is likewise not updatable: it is not part of the create DTO, the
 * global `ValidationPipe` runs with `forbidNonWhitelisted`, so a patch body
 * carrying `role` is rejected rather than silently stripped.
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'stellarPublicKey'] as const),
) {}
