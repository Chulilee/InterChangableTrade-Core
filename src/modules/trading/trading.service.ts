import { Injectable, BadRequestException } from '@nestjs/common';
import { Asset } from '../assets/entities/asset.entity';
import { AssetStatus } from '../assets/entities/asset.entity';

@Injectable()
export class TradingService {
  validateTrade(fromAsset: Asset, toAsset: Asset): void {
    if (
      fromAsset.status === AssetStatus.DEPRECATED ||
      toAsset.status === AssetStatus.DEPRECATED
    ) {
      throw new BadRequestException('Cannot trade deprecated assets');
    }

    if (!fromAsset.isTradeable || !toAsset.isTradeable) {
      throw new BadRequestException('One or both assets are not tradeable');
    }
  }
}
