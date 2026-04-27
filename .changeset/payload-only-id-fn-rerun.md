---
"effect-encore": minor
---

Payload-only per-op API + unified `id` fn + surgical rerun primitive.

**EntityActor — per-op `OperationHandle`**

Each operation tag is now a handle exposing payload-only methods. The old `Actor.ref(entityId)` + `ref.execute(Actor.Op({...}))` shape is gone.

```ts
// before
const ref = yield * Counter.ref("loc-A");
yield * ref.execute(Counter.Increment({ amount: 5 }));

// after
yield * Counter.Increment.execute({ id: "loc-A", amount: 5 });
```

`OperationHandle` exposes `execute / send / executionId / peek / watch / waitFor / rerun / make`. Actor-level surface is just `flush / redeliver / interrupt / Context / of / $is`.

**WorkflowActor — payload-only at actor level**

Workflows have one op, so methods promote to actor level: `Workflow.execute(payload) / .send / .executionId / .peek / .watch / .waitFor / .rerun / .make`. `ref()` and the `Run` constructor are removed; `make(payload)` is the escape hatch.

**Unified `id` fn**

`OperationDef.primaryKey` and `WorkflowDef.idempotencyKey` are replaced by a single `id` fn:

- `id` returns `string` → `entityId === primaryKey` (entity); idempotency key (workflow).
- `id` returns `{ entityId, primaryKey? }` → divergent dedup (entity only; workflows reject the object form at the type level). `primaryKey` defaults to `entityId` when omitted.

**Surgical `.rerun(payload)`**

Dedup records survive forever. `.rerun(payload)` is the surgical escape hatch:

- Entity: derives `{entityId, primaryKey}`, deletes the targeted envelope via `EncoreMessageStorage.deleteEnvelope`. No-op on non-existent execId.
- Workflow: `WorkflowEngine.interrupt` + `EncoreMessageStorage.clearAddress` — wipes run reply and every cached activity reply.

**`EncoreMessageStorage`**

New Context.Tag at `effect-encore/storage` extending upstream `MessageStorage` with `deleteEnvelope(requestId)`. Adapters provide both via `encoreMessageStorageLayer(upstream, { deleteEnvelope })` or `fromMessageStorage(storage, { deleteEnvelope })`. Required by `.rerun` on entities.

**`interrupt` rewired**

Entity-level `interrupt(entityId)` now calls `storage.clearAddress(address)` (was `Effect.die`). Distinct intent from `flush` (same impl): "stop accepting more work" vs "clean slate". Programmatic in-flight fiber cancellation still requires `Sharding.passivate` (not yet public upstream).

**Reserved keys (entity)**

Reserved operation names now: `_tag, _meta, $is, Context, name, type, of, interrupt, flush, redeliver, pipe`. (`ref / peek / watch / waitFor / executionId` removed — they're now per-op handle methods, not actor-level.)
