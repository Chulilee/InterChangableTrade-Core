import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PaginationQueryDto } from '@app/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { UserRole } from './entities/user.entity';

/**
 * Every route requires authentication, and access beyond your own account
 * requires the admin role. `stellarPublicKey` and `role` cannot be changed
 * through the update endpoint — the key may only be set through the verified
 * Stellar challenge flow and roles are only assigned by admins.
 */
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token' })
@ApiForbiddenResponse({ description: 'Caller may not access this user' })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a user (admin only)' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List users (paginated, admin only)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id (owner or admin)' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    this.assertOwnerOrAdmin(id, caller);
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user (owner or admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: UpdateUserDto,
  ) {
    this.assertOwnerOrAdmin(id, caller);
    return this.usersService.update(
      id,
      dto,
      caller.id,
      caller.role === UserRole.ADMIN,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a user (admin only)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }

  /**
   * A caller may only read or modify their own record; admins may access any.
   */
  private assertOwnerOrAdmin(
    id: string,
    caller: AuthenticatedUser,
  ): void {
    if (caller.id !== id && caller.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'You may only access your own user account',
      );
    }
  }
}
