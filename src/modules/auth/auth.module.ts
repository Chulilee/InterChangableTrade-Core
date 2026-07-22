import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { RolesGuard } from './guards/roles.guard';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { AuthAuditService } from './auth-audit.service';
import { AuthRateLimiterService } from './auth-rate-limiter.service';
import { StellarAuthService } from './stellar-auth.service';
import { ApiKeysService } from './api-keys.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { ApiKey } from './entities/api-key.entity';
import { AuthAuditLog } from './entities/auth-audit-log.entity';
import { StellarAuthChallenge } from './entities/stellar-auth-challenge.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.expiresIn'),
        },
      }),
    }),
    TypeOrmModule.forFeature([
      RefreshToken,
      ApiKey,
      AuthAuditLog,
      StellarAuthChallenge,
      PasswordResetToken,
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    ApiKeyStrategy,
    RolesGuard,
    ApiKeyAuthGuard,
    AuthAuditService,
    AuthRateLimiterService,
    StellarAuthService,
    ApiKeysService,
  ],
  exports: [AuthService, AuthAuditService, RolesGuard],
})
export class AuthModule {}
