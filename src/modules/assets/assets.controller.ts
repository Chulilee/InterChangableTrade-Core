import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AssetsService } from './assets.service';
import { AssetIndexerService } from './asset-indexer.service';
import { IndexAssetDto } from './dto/index-asset.dto';
import { QueryAssetDto } from './dto/query-asset.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assetsService: AssetsService,
    private readonly indexer: AssetIndexerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List indexed assets (paginated)' })
  findAll(@Query() query: QueryAssetDto) {
    return this.assetsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an indexed asset by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.assetsService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register or update an indexed asset (admin)' })
  upsert(@Body() dto: IndexAssetDto) {
    return this.assetsService.upsert(dto);
  }

  @Post('reindex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Trigger an indexing pass (admin)' })
  async reindex() {
    const processed = await this.indexer.runIndexingPass();
    return { processed };
  }
}
