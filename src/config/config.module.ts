import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import configuration from './configuration';
import { envValidationSchema } from './env.validation';

/**
 * Wraps `@nestjs/config` with our typed factory and startup validation.
 * Marked global so any module can inject `ConfigService` without re-importing.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
        // Explicit (it is also @nestjs/config's default): process.env always
        // carries OS variables. See the policy note in env.validation.ts.
        allowUnknown: true,
      },
    }),
  ],
})
export class ConfigModule {}
