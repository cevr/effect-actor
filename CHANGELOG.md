# effect-encore

## 0.3.0

### Minor Changes

- [`f3cf47b`](https://github.com/cevr/effect-encore/commit/f3cf47b72f9d1bbe182b8676fcd126446ea21b99) Thanks [@cevr](https://github.com/cevr)! - ### Bug fixes
  - **ExecId parsing**: Use null byte separator instead of colon — fixes entity IDs/primary keys containing colons
  - **Peek decoding**: Decode encoded values from storage using `Schema.decodeUnknownEffect` (supports effectful schemas)
  - **Workflow peek cause**: Walk Exit/Cause tree properly — returns `Failure(error)`, `Defect(defect)`, or `Interrupted` instead of wrapping raw cause
  - **Zero-payload operations**: Install `PrimaryKey.symbol` on empty payload class for storage indexing
  - **Missing default**: `mapExitToPeekResult` switch now has default clause
  - **Unknown operation guard**: `Effect.die` with descriptive error instead of silent `undefined`
  - **Entity interrupt**: Stubbed with descriptive error (Sharding.passivate not public API)

  ### Features
  - **Scalar Schema payloads**: `payload: Schema.String` now works. Opaque payloads stored under `_payload`, accessed via `operation._payload` in handlers.
  - **Entity `executionId`**: Pure function `Actor.executionId(entityId, op)` computes `ExecId<S,E>` without executing
  - **Workflow `executionId`**: Now returns branded `ExecId<S,E>` instead of plain `string`
  - **`fromRpcs` on `Actor` namespace**: Escape hatch now accessible via `Actor.fromRpcs`

  ### Breaking changes
  - **ExecId format changed**: From `entityId:tag:primaryKey` to null byte separated. No migration needed (0 users, published last night).
  - **`withCompensation` removed from `WorkflowActorObject`**: Use `Workflow.withCompensation` from upstream directly — it's a workflow primitive, not an actor concern.
  - **Dead compat shims deleted**: `src/client.ts`, `src/handlers.ts`, `src/testing.ts` removed (no subpath exports referenced them).

  ### v3 parity
  - `WorkflowRunDefs` type ported — workflow actors retain typed `ActorRef`
  - Typed `toTestLayer`/`toLayer` overloads for both entity and workflow actors
  - All bug fixes mirrored

## 0.2.0

### Minor Changes

- [`ec79397`](https://github.com/cevr/effect-encore/commit/ec793974282f3c1b8b5a3fefa3a1c36cb92b9506) Thanks [@cevr](https://github.com/cevr)! - Unified Actor API with value-dispatch and layer-based lifecycle
  - `Actor.toLayer(actor)` — client-only layer (producer)
  - `Actor.toLayer(actor, handlers)` — consumer + producer layer (registers entity + provides Context)
  - `Actor.toTestLayer(actor, handlers)` — test layer via Entity.makeTestClient, provides Context
  - `.actor(id)` — yields an ActorRef from context: `const ref = yield* Counter.actor("id")`
  - Removed `Actor.Live` — folded into `Actor.toLayer`
  - Removed `Actor.Test` — replaced by `Actor.toTestLayer` (returns Layer, not Effect)
  - `Actor.Test` now accepts raw handlers instead of pre-built layers
  - Added `"actor"` to reserved operation names

- [`06290e3`](https://github.com/cevr/effect-encore/commit/06290e323ecb1d6de7766ae972cf576e352f1585) Thanks [@cevr](https://github.com/cevr)! - Unified call site for entities and workflows.

  **Breaking changes:**
  - `Actor.make` renamed to `Actor.fromEntity`
  - `primaryKey` is now mandatory on all operations
  - `cast` returns `ExecId<Success, Error>` (branded string) instead of `CastReceipt`
  - `peek`, `watch` moved to actor object methods (`actor.peek(execId)`, `actor.watch(execId)`)
  - Standalone `peek`, `watch`, `NoPrimaryKeyError`, `CastReceipt`, `makeCastReceipt` exports removed
  - `Workflow` namespace export removed — import `Activity`, `DurableDeferred`, `DurableClock` from upstream directly

  **New features:**
  - `Actor.fromWorkflow(name, def)` — workflow actors with unified `ref.call`/`ref.cast` interface
  - `ExecId<Success, Error>` — branded execution identifier with phantom types for typed `peek`
  - `actor.peek(execId)` / `actor.watch(execId)` / `actor.interrupt(id)` on actor objects
  - `PeekResult` now includes `Suspended` variant for workflow state
  - Workflow actors support `resume`, `executionId`, `withCompensation`
  - `Actor.toTestLayer` for workflows provides `WorkflowEngine.layerMemory` automatically
