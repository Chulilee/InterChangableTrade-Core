import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscrowAccount } from './entities/escrow-account.entity';
import { EscrowSignatory } from './entities/escrow-signatory.entity';
import { EscrowMilestone } from './entities/escrow-milestone.entity';
import { EscrowTimeline } from './entities/escrow-timeline.entity';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';
import { EscrowTimelineService } from './services/escrow-timeline.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EscrowAccount,
      EscrowSignatory,
      EscrowMilestone,
      EscrowTimeline,
    ]),
  ],
  controllers: [EscrowController],
  providers: [EscrowService, EscrowTimelineService],
  exports: [EscrowService],
})
export class EscrowModule {}
