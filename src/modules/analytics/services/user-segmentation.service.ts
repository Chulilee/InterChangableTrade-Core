import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets, MoreThan } from 'typeorm';
import { UserSegment, SegmentType } from '../entities/user-segment.entity';
import { User } from '../../users/entities/user.entity';
import { CreateSegmentDto } from '../dto/create-segment.dto';
import { UpdateSegmentDto } from '../dto/update-segment.dto';
import { Trade } from '../../trading-engine/entities/trade.entity';

@Injectable()
export class UserSegmentationService {
  private readonly logger = new Logger(UserSegmentationService.name);

  constructor(
    @InjectRepository(UserSegment)
    private readonly userSegmentRepository: Repository<UserSegment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
  ) {}

  async createSegment(createdBy: string, dto: CreateSegmentDto): Promise<UserSegment> {
    const segment = this.userSegmentRepository.create({
      ...dto,
      createdBy,
      userCount: dto.userIds?.length || 0,
      lastCalculatedAt: new Date(),
    });

    if (dto.segmentType === SegmentType.AUTO && dto.filterCriteria) {
      await this.recalculateSegmentUsers(segment);
    }

    return this.userSegmentRepository.save(segment);
  }

  async updateSegment(segmentId: string, dto: UpdateSegmentDto): Promise<UserSegment> {
    const segment = await this.userSegmentRepository.findOneBy({ id: segmentId });
    if (!segment) {
      throw new Error(`Segment ${segmentId} not found`);
    }

    Object.assign(segment, dto);
    
    if (dto.filterCriteria && segment.segmentType === SegmentType.AUTO) {
      await this.recalculateSegmentUsers(segment);
    }

    return this.userSegmentRepository.save(segment);
  }

  async recalculateSegmentUsers(segment: UserSegment): Promise<void> {
    this.logger.log(`Recalculating users for segment ${segment.id}`);
    
    if (segment.segmentType === SegmentType.MANUAL) {
      segment.userCount = segment.userIds.length;
      segment.lastCalculatedAt = new Date();
      return;
    }

    if (!segment.filterCriteria) {
      segment.userIds = [];
      segment.userCount = 0;
      segment.lastCalculatedAt = new Date();
      return;
    }

    const query = this.userRepository.createQueryBuilder('user');
    
    this.applyFilterCriteria(query, segment.filterCriteria);
    
    const users = await query.getMany();
    const userIds = users.map(u => u.id);
    
    segment.userIds = userIds;
    segment.userCount = userIds.length;
    segment.lastCalculatedAt = new Date();
    
    this.logger.log(`Segment ${segment.id} now has ${userIds.length} users`);
  }

  private applyFilterCriteria(query: any, criteria: Record<string, any>): void {
    const { minTrades, minVolume, lastLoginDays, roles, isActive, countries } = criteria;

    if (isActive !== undefined) {
      query.andWhere('user.isActive = :isActive', { isActive });
    }

    if (roles && roles.length > 0) {
      query.andWhere('user.roles && :roles', { roles });
    }

    if (lastLoginDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - lastLoginDays);
      query.andWhere('user.lastLoginAt >= :cutoffDate', { cutoffDate });
    }

    if (countries && countries.length > 0) {
      query.andWhere('user.country IN (:...countries)', { countries });
    }

    if (minTrades !== undefined || minVolume !== undefined) {
      query.leftJoin('trade', 'trade', 'trade.makerUserId = user.id OR trade.takerUserId = user.id');
      
      query.groupBy('user.id');
      
      if (minTrades !== undefined) {
        query.having('COUNT(trade.id) >= :minTrades', { minTrades });
      }
      
      if (minVolume !== undefined) {
        query.having('SUM(CAST(trade.quantity AS numeric) * CAST(trade.price AS numeric)) >= :minVolume', { minVolume });
      }
    }
  }

  async getAllSegments(): Promise<UserSegment[]> {
    return this.userSegmentRepository.find({
      where: { isDeleted: false, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async getSegmentById(segmentId: string): Promise<UserSegment> {
    const segment = await this.userSegmentRepository.findOneBy({ id: segmentId, isDeleted: false });
    if (!segment) {
      throw new Error(`Segment ${segmentId} not found`);
    }
    return segment;
  }

  async deleteSegment(segmentId: string): Promise<void> {
    const segment = await this.userSegmentRepository.findOneBy({ id: segmentId });
    if (!segment) {
      throw new Error(`Segment ${segmentId} not found`);
    }

    segment.isDeleted = true;
    segment.isActive = false;
    await this.userSegmentRepository.save(segment);
  }

  async getUserSegments(userId: string): Promise<UserSegment[]> {
    return this.userSegmentRepository
      .createQueryBuilder('segment')
      .where('segment.isActive = true AND segment.isDeleted = false')
      .andWhere(':userId = ANY(segment.userIds)', { userId })
      .getMany();
  }

  async recalculateAllAutoSegments(): Promise<void> {
    this.logger.log('Recalculating all auto segments');
    
    const autoSegments = await this.userSegmentRepository.find({
      where: { segmentType: SegmentType.AUTO, isActive: true, isDeleted: false },
    });

    for (const segment of autoSegments) {
      try {
        await this.recalculateSegmentUsers(segment);
        await this.userSegmentRepository.save(segment);
      } catch (error) {
        this.logger.error(`Failed to recalculate segment ${segment.id}`, error);
      }
    }

    this.logger.log(`Recalculated ${autoSegments.length} auto segments`);
  }

  async addUserToManualSegment(segmentId: string, userId: string): Promise<UserSegment> {
    const segment = await this.userSegmentRepository.findOneBy({ 
      id: segmentId, 
      segmentType: SegmentType.MANUAL,
      isDeleted: false 
    });
    
    if (!segment) {
      throw new Error(`Manual segment ${segmentId} not found`);
    }

    if (!segment.userIds.includes(userId)) {
      segment.userIds.push(userId);
      segment.userCount = segment.userIds.length;
    }

    return this.userSegmentRepository.save(segment);
  }

  async removeUserFromManualSegment(segmentId: string, userId: string): Promise<UserSegment> {
    const segment = await this.userSegmentRepository.findOneBy({ 
      id: segmentId, 
      segmentType: SegmentType.MANUAL,
      isDeleted: false 
    });
    
    if (!segment) {
      throw new Error(`Manual segment ${segmentId} not found`);
    }

    segment.userIds = segment.userIds.filter(id => id !== userId);
    segment.userCount = segment.userIds.length;

    return this.userSegmentRepository.save(segment);
  }
}