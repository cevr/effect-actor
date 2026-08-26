# ADR-0003 — Thin wrappers over Effect 4 RC

- **Status:** accepted
- **Date:** 2026-08-26

## Context

Encore simplifies Effect Cluster and Workflow APIs. It must not replace an upstream primitive with
custom runtime code when a direct delegate can provide the same contract.

Effect 4 RC provides Workflow execution, polling, interrupt, resume, Activity retry and races,
Durable Deferred signals, durable clocks, Workflow scopes, and finalizers. It does not provide the
complete Encore contracts for producer-only actor sends, effectful actor state, surgical entity
rerun, or operator-controlled durable compensation.

## Decision

1. Workflow lifecycle methods delegate to the upstream Workflow value.
2. Step sleep, race, signal race, idempotency key, attempt, scope, scope provision, and finalizer
   methods delegate directly to upstream Workflow modules.
3. The Step facade stays public. Its small delegates reduce the number of upstream modules that an
   application must assemble.
4. The Client builds an outgoing request only for producer-only sends. Upstream Sharding clients
   require a local Sharding service. Encore supports a storage-only producer.
5. Encore State stays custom. Its authoritative read and write operations can fail and can require
   services. A SubscriptionRef would add a second source of truth.
6. Durable compensation stays custom. Upstream Workflow compensation provides finalizers. Encore
   also persists the compensation plan and failed attempt. It validates Retry or Stop decisions from
   an operator.
7. Internal modules own these additions. The package root does not export internal compiler modules.

## Consequences

- Encore keeps a small application API over upstream Effect primitives.
- Effect owns runtime behavior wherever its public API satisfies the Encore contract.
- Custom code remains only where Encore adds a producer, state, deletion, or operator protocol.
- Effect RC updates require a source comparison before release.
