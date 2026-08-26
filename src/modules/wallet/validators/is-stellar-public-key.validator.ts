import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Validates that a string is a well-formed Stellar ed25519 public key (`G...`).
 *
 * Wraps the `Keypair.fromPublicKey` check already used ad-hoc in
 * `auth/stellar-auth.service.ts`, exposed as a reusable class-validator
 * decorator for DTOs.
 */
export function IsStellarPublicKey(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStellarPublicKey',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') {
            return false;
          }
          try {
            Keypair.fromPublicKey(value);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a valid Stellar public key (G...)`;
        },
      },
    });
  };
}
