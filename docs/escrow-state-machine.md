# Escrow lifecycle

Escrow accounts move through an explicit state machine defined in
`src/modules/escrow/escrow-state-machine.ts`. Every status change is validated
with `assertTransition(from, to)`, so an escrow can never jump between
unreachable states.

## Statuses

| Status               | Meaning                                                    |
| -------------------- | ---------------------------------------------------------- |
| `pending`            | Account created, not yet funded.                           |
| `funded`             | Funds deposited, awaiting signatures.                      |
| `approved`           | Signature threshold reached, ready for settlement.         |
| `partially_released` | Some funds released; the remainder is still in escrow.     |
| `settled`            | Fully released; terminal.                                  |
| `refunded`           | Returned to the creator; terminal.                         |
| `disputed`           | Frozen while a dispute is resolved.                        |
| `expired`            | Settlement window elapsed without agreement.               |
| `cancelled`          | Cancelled before funding; terminal.                        |

## Allowed transitions

```
pending            -> funded | cancelled | refunded | expired
funded             -> approved | disputed | refunded | expired | settled
approved           -> approved | partially_released | settled | disputed
partially_released -> partially_released | settled | disputed
disputed           -> settled | refunded
expired            -> refunded
settled            -> (terminal)
refunded           -> (terminal)
cancelled          -> (terminal)
```

`funded -> settled` is the time-locked auto-settlement path and does not
require signatures. User-initiated releases additionally require an
`approved` (or `partially_released`) escrow via `isApprovedForRelease()`;
admins may force-release from any non-terminal status.

## Events

Reaching `approved` emits both `escrow.signature_threshold_reached` and
`escrow.approved`. Other transitions emit their matching `escrow.*` event.
