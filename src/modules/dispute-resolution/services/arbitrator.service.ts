import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Arbitrator } from '../entities/arbitrator.entity';
import { DisputeClassification } from '../enums/dispute-classification.enum';
import { ArbitratorExpertise } from '../enums/arbitrator-expertise.enum';
import { CreateArbitratorDto } from '../dto/create-arbitrator.dto';
import { User, UserRole } from '../../users/entities/user.entity';

@Injectable()
export class ArbitratorService {
  constructor(
    @InjectRepository(Arbitrator)
    private readonly arbitratorRepository: Repository<Arbitrator>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  private classificationToExpertise(
    classification: DisputeClassification,
  ): ArbitratorExpertise {
    const mapping: Record<DisputeClassification, ArbitratorExpertise> = {
      [DisputeClassification.NON_DELIVERY]: ArbitratorExpertise.NON_DELIVERY,
      [DisputeClassification.WRONG_AMOUNT]: ArbitratorExpertise.WRONG_AMOUNT,
      [DisputeClassification.FRAUD]: ArbitratorExpertise.FRAUD,
      [DisputeClassification.SYSTEM_ERROR]: ArbitratorExpertise.SYSTEM_ERROR,
    };
    return mapping[classification];
  }

  async createArbitrator(dto: CreateArbitratorDto): Promise<Arbitrator> {
    const user = await this.userRepository.findOne({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException(`User ${dto.userId} not found`);
    }

    const existing = await this.arbitratorRepository.findOne({
      where: { userId: dto.userId },
    });
    if (existing) {
      throw new BadRequestException(
        'User is already registered as an arbitrator',
      );
    }

    const arbitrator = this.arbitratorRepository.create({
      userId: dto.userId,
      expertise: dto.expertise,
      maxActiveDisputes: dto.maxActiveDisputes ?? 10,
    });
    const saved = await this.arbitratorRepository.save(arbitrator);

    if (user.role !== UserRole.ADMIN) {
      user.role = UserRole.ARBITRATOR;
      await this.userRepository.save(user);
    }

    return saved;
  }

  async assignArbitrator(
    classification: DisputeClassification,
  ): Promise<Arbitrator | null> {
    const requiredExpertise = this.classificationToExpertise(classification);

    const arbitrators = await this.arbitratorRepository
      .createQueryBuilder('arbitrator')
      .where('arbitrator.isAvailable = :available', { available: true })
      .andWhere('arbitrator.activeDisputeCount < arbitrator.maxActiveDisputes')
      .andWhere(
        ':expertise = ANY(arbitrator.expertise) OR :general = ANY(arbitrator.expertise)',
        {
          expertise: requiredExpertise,
          general: ArbitratorExpertise.GENERAL,
        },
      )
      .orderBy('arbitrator.activeDisputeCount', 'ASC')
      .getMany();

    if (arbitrators.length === 0) {
      return null;
    }

    const selected = arbitrators[0];
    selected.activeDisputeCount += 1;
    await this.arbitratorRepository.save(selected);
    return selected;
  }

  async releaseArbitrator(arbitratorUserId: string): Promise<void> {
    const arbitrator = await this.arbitratorRepository.findOne({
      where: { userId: arbitratorUserId },
    });
    if (arbitrator && arbitrator.activeDisputeCount > 0) {
      arbitrator.activeDisputeCount -= 1;
      arbitrator.totalResolved += 1;
      await this.arbitratorRepository.save(arbitrator);
    }
  }

  async findAll(): Promise<Arbitrator[]> {
    return this.arbitratorRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findByUserId(userId: string): Promise<Arbitrator> {
    const arbitrator = await this.arbitratorRepository.findOne({
      where: { userId },
    });
    if (!arbitrator) {
      throw new NotFoundException(`Arbitrator for user ${userId} not found`);
    }
    return arbitrator;
  }
}
