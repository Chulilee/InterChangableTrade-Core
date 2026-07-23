import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  StellarChallengeRequestDto,
  StellarVerifyDto,
} from './dto/stellar-auth.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import {
  RequestPasswordResetDto,
  ConfirmPasswordResetDto,
} from './dto/password-reset.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from './decorators/current-user.decorator';
import { ApiKeysService } from './api-keys.service';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';

/** Extracts a best-effort RequestContext from the Express request. */
function requestContext(req: Request) {
  return {
    ipAddress:
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
    deviceHint: req.headers['x-device-hint'] as string | undefined,
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  // --------------------------------------------------------------------------
  // Email / Password
  // --------------------------------------------------------------------------

  @Post('register')
  @ApiOperation({ summary: 'Register a new account and receive token pair' })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, requestContext(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for a JWT and refresh token' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, requestContext(req));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the currently authenticated user' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  // --------------------------------------------------------------------------
  // Refresh & Logout
  // --------------------------------------------------------------------------

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refreshAccessToken(dto.refreshToken, requestContext(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the provided refresh token' })
  logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RefreshTokenDto,
  ) {
    return this.authService.logout(user.id, dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke all refresh tokens for the current user' })
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logoutAll(user.id);
  }

  // --------------------------------------------------------------------------
  // Stellar Wallet Authentication
  // --------------------------------------------------------------------------

  @Post('stellar/challenge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Request a sign challenge for Stellar wallet authentication (step 1)',
  })
  stellarChallenge(
    @Body() dto: StellarChallengeRequestDto,
    @Req() req: Request,
  ) {
    return this.authService.stellarChallenge(dto.publicKey, requestContext(req));
  }

  @Post('stellar/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Submit signed challenge to receive a JWT (step 2)',
  })
  stellarVerify(@Body() dto: StellarVerifyDto, @Req() req: Request) {
    return this.authService.stellarVerify(
      dto.nonce,
      dto.publicKey,
      dto.signature,
      requestContext(req),
    );
  }

  // --------------------------------------------------------------------------
  // Password Reset
  // --------------------------------------------------------------------------

  @Post('password-reset/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Request a password reset email',
  })
  requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
    @Req() req: Request,
  ) {
    return this.authService.requestPasswordReset(dto.email, requestContext(req));
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Confirm password reset with the token received via email',
  })
  confirmPasswordReset(
    @Body() dto: ConfirmPasswordResetDto,
    @Req() req: Request,
  ) {
    return this.authService.confirmPasswordReset(
      dto.token,
      dto.newPassword,
      requestContext(req),
    );
  }

  // --------------------------------------------------------------------------
  // API Keys
  // --------------------------------------------------------------------------

  @Post('api-keys')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new API key for the authenticated user',
    description:
      'The plain key is returned **once** and is not recoverable. Store it securely.',
  })
  createApiKey(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.create(user.id, dto);
  }

  @Get('api-keys')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List API keys for the authenticated user' })
  listApiKeys(@CurrentUser() user: AuthenticatedUser) {
    return this.apiKeysService.listForUser(user.id);
  }

  @Delete('api-keys/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke an API key' })
  revokeApiKey(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apiKeysService.revoke(user.id, id);
  }

  // --------------------------------------------------------------------------
  // Example: API-key protected route
  // --------------------------------------------------------------------------

  @Get('api-key/verify')
  @UseGuards(ApiKeyAuthGuard)
  @ApiHeader({ name: 'x-api-key', description: 'API key', required: true })
  @ApiOperation({
    summary: 'Verify an API key and return the associated identity',
  })
  verifyApiKey(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
