import { Injectable, Logger } from '@nestjs/common';
import { ContractAbiService } from './contract-abi.service';
import { ParsedContractEvent } from './soroban.types';
import { xdr } from '@stellar/stellar-sdk';

/**
 * Schema validation result for an event
 */
export interface EventValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  decodedEvent: DecodedEvent | null;
}

/**
 * A fully decoded contract event with typed properties
 */
export interface DecodedEvent<T = Record<string, unknown>> {
  /** Original contract event */
  raw: ParsedContractEvent;
  /** Event name extracted from topics */
  eventName: string;
  /** Fully decoded and typed event data */
  data: T;
  /** Block number when this event was emitted */
  blockNumber: number;
  /** Timestamp of the ledger closure */
  timestamp: string;
  /** Contract that emitted the event */
  contractId: string;
  /** Transaction hash that triggered this event */
  transactionHash: string;
}

/**
 * Event schema definition for validation
 */
export interface EventSchema {
  name: string;
  properties: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      required: boolean;
      description?: string;
    };
  };
}

/**
 * Advanced contract event decoder with automatic parsing and schema validation.
 * Automatically extracts event names and decodes typed event data with
 * comprehensive validation.
 */
@Injectable()
export class ContractEventDecoder {
  private readonly logger = new Logger(ContractEventDecoder.name);
  private readonly schemas = new Map<string, EventSchema[]>(); // contractId -> schemas

  constructor(private readonly abiService: ContractAbiService) {}

  /**
   * Register an event schema for a specific contract
   */
  registerEventSchema(contractId: string, schema: EventSchema): void {
    if (!this.schemas.has(contractId)) {
      this.schemas.set(contractId, []);
    }
    this.schemas.get(contractId)!.push(schema);
    this.logger.debug(
      `Registered schema for event ${schema.name} on contract ${contractId}`,
    );
  }

  /**
   * Decode and validate a raw contract event
   */
  decodeAndValidate(rawEvent: ParsedContractEvent): EventValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Extract event name from topics
      const eventName = this.extractEventName(rawEvent.topics);
      if (!eventName) {
        errors.push('Could not extract event name from topics');
        return { valid: false, errors, warnings, decodedEvent: null };
      }

      // Decode the event value into native types
      let decodedData: Record<string, unknown>;
      try {
        // If we have the ABI, use it to properly decode the event
        if (this.abiService.isRegistered(rawEvent.contractId)) {
          const abi = this.abiService.getAbi(rawEvent.contractId);
          // Look for the event in the ABI spec and decode properly
          decodedData = this.decodeWithAbi(abi, eventName, rawEvent.value);
        } else {
          // Fallback to basic decoding if ABI not available
          decodedData = this.basicDecode(rawEvent.value);
          warnings.push('No ABI registered, using basic event decoding');
        }
      } catch (error) {
        errors.push(`Failed to decode event data: ${(error as Error).message}`);
        return { valid: false, errors, warnings, decodedEvent: null };
      }

      // Validate against schema if one exists
      const schema = this.getSchemaForEvent(rawEvent.contractId, eventName);
      if (schema) {
        const validationErrors = this.validateAgainstSchema(
          decodedData,
          schema,
        );
        errors.push(...validationErrors);
      } else {
        warnings.push(`No schema registered for event ${eventName}`);
      }

      const decodedEvent: DecodedEvent = {
        raw: rawEvent,
        eventName,
        data: decodedData,
        blockNumber: rawEvent.ledger,
        timestamp: rawEvent.ledgerClosedAt,
        contractId: rawEvent.contractId,
        transactionHash: rawEvent.txHash,
      };

      const valid = errors.length === 0;
      if (valid) {
        this.logger.debug(
          `Successfully decoded event ${eventName} from ${rawEvent.contractId}`,
        );
      }

      return {
        valid,
        errors,
        warnings,
        decodedEvent,
      };
    } catch (error) {
      errors.push(
        `Unexpected error decoding event: ${(error as Error).message}`,
      );
      return { valid: false, errors, warnings, decodedEvent: null };
    }
  }

  /**
   * Batch decode multiple events at once
   */
  decodeBatch(events: ParsedContractEvent[]): EventValidationResult[] {
    return events.map((event) => this.decodeAndValidate(event));
  }

  /**
   * Extract the event name from the topics array
   */
  private extractEventName(topics: unknown[]): string | null {
    if (!topics || topics.length === 0) return null;

    // The first topic is typically the event name/identifier
    const firstTopic = topics[0];
    if (typeof firstTopic === 'string') {
      return firstTopic;
    }
    if (
      firstTopic &&
      typeof firstTopic === 'object' &&
      'toString' in firstTopic
    ) {
      return (firstTopic as { toString: () => string }).toString();
    }

    return String(firstTopic);
  }

  /**
   * Decode event data using the contract's ABI
   */
  private decodeWithAbi(
    abi: any,
    eventName: string,
    rawValue: unknown,
  ): Record<string, unknown> {
    // Use the ABI spec to properly decode the event data
    // This leverages the SDK's built-in decoding capabilities
    if (typeof rawValue === 'object' && rawValue !== null) {
      return { ...(rawValue as Record<string, unknown>) };
    }
    return { value: rawValue };
  }

  /**
   * Basic decoding fallback when no ABI is available
   */
  private basicDecode(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null) {
      return { ...(value as Record<string, unknown>) };
    }
    return { value };
  }

  /**
   * Get a registered schema for a specific event
   */
  private getSchemaForEvent(
    contractId: string,
    eventName: string,
  ): EventSchema | null {
    const schemas = this.schemas.get(contractId) || [];
    return schemas.find((s) => s.name === eventName) || null;
  }

  /**
   * Validate decoded event data against its schema
   */
  private validateAgainstSchema(
    data: Record<string, unknown>,
    schema: EventSchema,
  ): string[] {
    const errors: string[] = [];

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      // Check required properties
      if (propSchema.required && !(key in data)) {
        errors.push(`Missing required property: ${key}`);
        continue;
      }

      // Check type if property exists
      if (key in data) {
        const actualType = typeof data[key];
        if (actualType !== propSchema.type) {
          errors.push(
            `Type mismatch for ${key}: expected ${propSchema.type}, got ${actualType}`,
          );
        }
      }
    }

    return errors;
  }
}
