import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { MultisigTransaction } from './entities/multisig-transaction.entity';
import { MultisigSignature } from './entities/multisig-signature.entity';
import { WalletService } from './wallet.service';
import { MultisigAccountService } from './services/multisig-account.service';
import { MultisigTransactionService } from './services/multisig-transaction.service';
import { WalletController } from './wallet.controller';
import { MultisigController } from './multisig.controller';
import { StellarModule } from '../stellar/stellar.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, MultisigTransaction, MultisigSignature]),
    StellarModule,
    TransactionsModule,
  ],
  controllers: [WalletController, MultisigController],
  providers: [
    WalletService,
    MultisigAccountService,
    MultisigTransactionService,
  ],
  exports: [WalletService, MultisigAccountService, MultisigTransactionService],
})
export class WalletModule {}
