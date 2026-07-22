import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginatedResultDto } from '@app/common';
import { TrustLine } from './entities/trustline.entity';
import { CreateTrustlineDto } from './dto/create-trustline.dto';
import { QueryTrustlineDto } from './dto/query-trustline.dto';
import { Asset } from './entities/asset.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class TrustlinesService {
  constructor(
    @InjectRepository(TrustLine)
    private readonly trustlinesRepository: Repository<TrustLine>,
    @InjectRepository(Asset)
    private readonly assetsRepository: Repository<Asset>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(dto: CreateTrustlineDto): Promise<TrustLine> {
    const user = await this.usersRepository.findOne({
      where: { id: dto.user },
    });
    if (!user) {
      throw new NotFoundException(`User ${dto.user} not found`);
    }

    const asset = await this.assetsRepository.findOne({
      where: { id: dto.asset },
    });
    if (!asset) {
      throw new NotFoundException(`Asset ${dto.asset} not found`);
    }

    const trustline = this.trustlinesRepository.create({
      user,
      asset,
      limit: dto.limit,
      balance: '0',
    });

    return this.trustlinesRepository.save(trustline);
  }

  async findAll(
    query: QueryTrustlineDto,
  ): Promise<PaginatedResultDto<TrustLine>> {
    const qb = this.trustlinesRepository
      .createQueryBuilder('trustline')
      .leftJoinAndSelect('trustline.user', 'user')
      .leftJoinAndSelect('trustline.asset', 'asset')
      .orderBy('trustline.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (query.user) {
      qb.andWhere('trustline.user = :user', { user: query.user });
    }

    if (query.asset) {
      qb.andWhere('trustline.asset = :asset', { asset: query.asset });
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<TrustLine> {
    const trustline = await this.trustlinesRepository.findOne({
      where: { id },
      relations: ['user', 'asset'],
    });
    if (!trustline) {
      throw new NotFoundException(`Trustline ${id} not found`);
    }
    return trustline;
  }

  async remove(id: string): Promise<void> {
    const trustline = await this.findOne(id);
    await this.trustlinesRepository.remove(trustline);
  }

  async updateBalance(id: string, amount: string): Promise<TrustLine> {
    const trustline = await this.findOne(id);
    const newBalance = BigInt(trustline.balance) + BigInt(amount);

    if (newBalance < 0) {
      throw new BadRequestException('Insufficient balance');
    }

    if (newBalance > BigInt(trustline.limit)) {
      throw new BadRequestException('Trustline limit exceeded');
    }

    trustline.balance = newBalance.toString();
    return this.trustlinesRepository.save(trustline);
  }
}
