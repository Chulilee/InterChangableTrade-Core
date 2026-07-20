import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { rpc } from '@stellar/stellar-sdk';
import { SorobanClientService } from './soroban-client.service';
import { ContractAbiService } from './contract-abi.service';
import { ContractInvocationService } from './contract-invocation.service';
import { ContractStateService } from './contract-state.service';
import { ContractEventIndexerService } from './contract-event-indexer.service';
import {
  GetContractStateDto,
  InvokeSorobanContractDto,
  RegisterAbiDto,
  WatchEventsDto,
} from './dto/soroban-contract.dto';

/**
 * HTTP surface for the Soroban module. Read paths (simulate, gas estimate,
 * state, events) are safe and require no signer. Write paths (`/invoke`) mutate
 * chain state and require a configured server signer.
 *
 * NOTE: these routes are currently unauthenticated. Before exposing the write
 * endpoints publicly, guard them (e.g. with the app's JWT auth guard) so only
 * authorized callers can spend the server signer's funds.
 */
@ApiTags('soroban')
@Controller('soroban')
export class SorobanContractController {
  constructor(
    private readonly client: SorobanClientService,
    private readonly abi: ContractAbiService,
    private readonly invocation: ContractInvocationService,
    private readonly state: ContractStateService,
    private readonly events: ContractEventIndexerService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Soroban RPC health and network status' })
  getStatus() {
    return this.client.getNetworkStatus();
  }

  @Post('abi')
  @ApiOperation({ summary: 'Register a contract ABI from XDR spec entries' })
  async registerAbi(@Body() dto: RegisterAbiDto) {
    const registered = this.abi.registerFromXdr(
      dto.contractId,
      dto.specEntriesXdr,
    );
    return {
      contractId: registered.contractId,
      functions: registered.functions,
    };
  }

  @Post('abi/:contractId/from-network')
  @ApiOperation({ summary: 'Register a contract ABI from its on-chain WASM' })
  async registerAbiFromNetwork(@Param('contractId') contractId: string) {
    const registered = await this.abi.registerFromNetwork(contractId);
    return {
      contractId: registered.contractId,
      functions: registered.functions,
    };
  }

  @Get('abi/:contractId')
  @ApiOperation({ summary: 'List the registered functions for a contract' })
  listFunctions(@Param('contractId') contractId: string) {
    return this.abi.listFunctions(contractId);
  }

  @Post('simulate')
  @ApiOperation({
    summary: 'Simulate a read-only contract call (with gas estimate)',
  })
  simulate(@Body() dto: InvokeSorobanContractDto) {
    return this.invocation.simulate({
      contractId: dto.contractId,
      method: dto.method,
      args: dto.args,
    });
  }

  @Post('estimate-gas')
  @ApiOperation({ summary: 'Estimate the resource fee of an invocation' })
  estimateGas(@Body() dto: InvokeSorobanContractDto) {
    return this.invocation.estimateGas({
      contractId: dto.contractId,
      method: dto.method,
      args: dto.args,
    });
  }

  @Post('invoke')
  @ApiOperation({
    summary: 'Submit a signed, state-changing contract invocation',
  })
  invoke(@Body() dto: InvokeSorobanContractDto) {
    return this.invocation.invoke({
      contractId: dto.contractId,
      method: dto.method,
      args: dto.args,
    });
  }

  @Post('state')
  @ApiOperation({ summary: 'Read a contract storage entry (cached)' })
  getState(@Body() dto: GetContractStateDto) {
    const durability =
      dto.durability === 'temporary'
        ? rpc.Durability.Temporary
        : rpc.Durability.Persistent;
    return this.state.getState(dto.contractId, dto.key, {
      durability,
      forceRefresh: dto.forceRefresh,
    });
  }

  @Post('events/watch')
  @ApiOperation({ summary: 'Start indexing a contract for events' })
  async watchEvents(@Body() dto: WatchEventsDto) {
    await this.events.watch(dto.contractId, dto.fromLedger);
    return { watching: dto.contractId, fromLedger: dto.fromLedger ?? null };
  }

  @Get('events/:contractId')
  @ApiOperation({ summary: 'Query indexed events for a contract' })
  getEvents(
    @Param('contractId') contractId: string,
    @Query('fromLedger') fromLedger?: string,
    @Query('limit') limit?: string,
  ) {
    return this.events.getEvents(contractId, {
      fromLedger: fromLedger ? parseInt(fromLedger, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
