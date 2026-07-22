import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SorobanNetworkInfo {
  rpcUrl: string;
  passphrase: string;
}

/**
 * Soroban smart-contract interaction service. This scaffolds the configuration
 * and read surface for contract calls; signing/submitting invocations is added
 * as contracts are onboarded, keeping the MVP free of key-management concerns.
 */
@Injectable()
export class SorobanService {
  private readonly logger = new Logger(SorobanService.name);
  private readonly rpcUrl: string;
  private readonly passphrase: string;

  constructor(private readonly configService: ConfigService) {
    this.rpcUrl = this.configService.get<string>('stellar.sorobanRpcUrl')!;
    this.passphrase = this.configService.get<string>(
      'stellar.networkPassphrase',
    )!;
  }

  getNetworkInfo(): SorobanNetworkInfo {
    return { rpcUrl: this.rpcUrl, passphrase: this.passphrase };
  }

  /**
   * Placeholder for read-only contract invocation. Returns a structured
   * not-yet-implemented marker so the API contract is stable while the
   * underlying contract bindings are wired up.
   */
  async simulate(
    contractId: string,
    method: string,
  ): Promise<{ contractId: string; method: string; status: string }> {
    this.logger.debug(
      `Simulate requested for ${contractId}.${method} (not yet implemented)`,
    );
    return { contractId, method, status: 'not-implemented' };
  }
}
