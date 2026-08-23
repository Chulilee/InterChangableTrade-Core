export enum BlockchainEventType {
  PAYMENT = 'payment',
  PATH_PAYMENT_STRICT_RECEIVE = 'path_payment_strict_receive',
  PATH_PAYMENT_STRICT_SEND = 'path_payment_strict_send',
  MANAGE_OFFER = 'manage_offer',
  MANAGE_OFFER_WITHDRAW = 'manage_offer_withdraw',
  CREATE_ACCOUNT = 'create_account',
  ACCOUNT_MERGE = 'account_merge',
  TRANSACTION = 'transaction',
  // Soroban contract event types
  SOROBAN_CONTRACT_INVOCATION = 'soroban_contract_invocation',
  SOROBAN_CONTRACT_EVENT = 'soroban_contract_event',
  SOROBAN_SYSTEM_EVENT = 'soroban_system_event',
  SOROBAN_DIAGNOSTIC_EVENT = 'soroban_diagnostic_event',
}
