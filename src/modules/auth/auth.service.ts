import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

export interface AuthResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Registers a new account and immediately issues a token so the client can
   * proceed without a second round-trip to log in.
   */
  async register(dto: RegisterDto): Promise<AuthResult> {
    const user = await this.usersService.create(dto);
    return this.issueToken(user.id, user.email, user.role);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmailWithSecret(dto.email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueToken(user.id, user.email, user.role);
  }

  private issueToken(id: string, email: string, role: string): AuthResult {
    const payload: JwtPayload = { sub: id, email, role };
    return {
      accessToken: this.jwtService.sign(payload),
      user: { id, email, role },
    };
  }
}
