import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TrustlinesService } from './trustlines.service';
import { CreateTrustlineDto } from './dto/create-trustline.dto';
import { QueryTrustlineDto } from './dto/query-trustline.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('trustlines')
@Controller('trustlines')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TrustlinesController {
  constructor(private readonly trustlinesService: TrustlinesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new trustline' })
  create(@Body() dto: CreateTrustlineDto) {
    return this.trustlinesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List trustlines (paginated)' })
  findAll(@Query() query: QueryTrustlineDto) {
    return this.trustlinesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a trustline by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.trustlinesService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a trustline' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.trustlinesService.remove(id);
  }
}
