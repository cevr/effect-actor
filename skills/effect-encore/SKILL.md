---
name: effect-encore
description: Erlang gen_server semantics over @effect/cluster. Use when building actor/entity definitions with effect-encore, wiring handlers, writing call/cast/peek/watch patterns, testing actors, defining workflows, or migrating from raw @effect/cluster Entity/Rpc/RpcGroup code.
---

# effect-encore

Thin protocol layer over `@effect/cluster` providing Erlang gen_server semantics. Unified call site for entities and workflows.

## Navigation

```
What are you working on?
├─ Defining an entity              → §Entity
├─ Defining a workflow             → §Workflow
├─ Wiring handlers / layers        → §Handle
├─ Calling / casting               → §Client
├─ Tracking execution (peek/watch) → §Peek
├─ Testing                         → §Test
├─ Lifecycle (interrupt/resume)    → §Lifecycle
├─ Delayed delivery (deliverAt)    → §DeliverAt
├─ Observability                   → §Observability
├─ v3 compatibility                → §v3
└─ Migrating from raw cluster      → §Migration
```

## Core Concepts

- **Unified call site.** Entities and workflows share `ref.call(op)` / `ref.cast(op)`. Callers don't care which is which.
- **Delivery mode is the caller's choice.** Every operation supports `call` and `cast`. The definition doesn't decide — the caller does.
- **Value dispatch.** Construct an operation value, pass it to `ref.call(op)` or `ref.cast(op)`.
- **One layer, two roles.** `Actor.toLayer(actor, handlers)` = consumer + producer. `Actor.toLayer(actor)` = producer only.
- **Compiles to @effect/cluster.** Not a new runtime. `Actor.fromEntity` produces an `Entity`, `Actor.fromWorkflow` wraps `Workflow.make`.

## Entity

### Multi-operation entity actor

```ts
const Counter = Actor.fromEntity("Counter", {
  Increment: {
    payload: { amount: Schema.Number },
    success: Schema.Number,
    primaryKey: (p) => String(p.amount),
  },
  GetCount: {
    success: Schema.Number,
    primaryKey: () => "singleton",
  },
});

// Constructors are on the object directly
Counter.Increment({ amount: 5 }); // → OperationValue
Counter.GetCount(); // zero-input, still callable
```

### OperationDef fields

| Field        | Type                                 | Required | Description                             |
| ------------ | ------------------------------------ | -------- | --------------------------------------- |
| `payload`    | `Schema.Top \| Schema.Struct.Fields` | no       | Inline fields or pre-built Schema.Class |
| `success`    | `Schema.Top`                         | no       | Success response schema (default: Void) |
| `error`      | `Schema.Top`                         | no       | Error schema (default: Never)           |
| `persisted`  | `boolean`                            | no       | Persist to MessageStorage               |
| `primaryKey` | `(payload) => string`                | **yes**  | Deduplication / exec ID key             |
| `deliverAt`  | `(payload) => DateTime`              | no       | Delayed delivery extractor              |

### ActorObject properties

| Property                    | Type        | Description                               |
| --------------------------- | ----------- | ----------------------------------------- |
| `Counter.Increment(...)`    | Constructor | Returns `OperationValue`                  |
| `Counter._meta.name`        | `"Counter"` | Actor name (literal type)                 |
| `Counter._meta.entity`      | `Entity`    | Underlying cluster Entity                 |
| `Counter._meta.definitions` | Record      | Raw operation definitions                 |
| `Counter.Context`           | Context tag | DI tag for client factory                 |
| `Counter.actor(id)`         | Method      | `yield* Counter.actor("id")` → `ActorRef` |
| `Counter.peek(execId)`      | Method      | One-shot status check                     |
| `Counter.watch(execId)`     | Method      | Polling stream of status changes          |
| `Counter.interrupt(id)`     | Method      | Passivate entity                          |
| `Counter.$is(tag)`          | Type guard  | `Counter.$is("Increment")(value)`         |

### Reserved operation names

`_tag`, `_meta`, `$is`, `Context`, `actor`, `peek`, `watch`, `interrupt` — compile-time type guard + runtime check.

### Pre-built Schema.Class payload

Escape hatch for custom symbol implementations. The `primaryKey`/`deliverAt` options in OperationDef are ignored when using a Schema.Class — symbols must be on the class.

```ts
class CustomPayload extends Schema.Class<CustomPayload>("CustomPayload")({
  id: Schema.String,
}) {
  [PrimaryKey.symbol]() {
    return this.id;
  }
}

const MyActor = Actor.fromEntity("MyActor", {
  Run: { payload: CustomPayload, success: Schema.Void, persisted: true, primaryKey: (p) => p.id },
});
```

## Workflow

### Workflow actor (single-op "Run")

```ts
const ProcessOrder = Actor.fromWorkflow("ProcessOrder", {
  payload: { orderId: Schema.String },
  success: OrderResult,
  error: OrderError,
  idempotencyKey: (p) => p.orderId,
});

// Single constructor — always "Run"
ProcessOrder.Run({ orderId: "ord-1" }); // → OperationValue
```

### WorkflowDef fields

| Field            | Type                   | Required | Description                    |
| ---------------- | ---------------------- | -------- | ------------------------------ |
| `payload`        | `Schema.Struct.Fields` | **yes**  | Workflow input fields          |
| `success`        | `Schema.Top`           | no       | Success schema (default: Void) |
| `error`          | `Schema.Top`           | no       | Error schema (default: Never)  |
| `idempotencyKey` | `(payload) => string`  | **yes**  | Deterministic execution ID     |

### WorkflowActorObject properties

All entity properties plus:

| Property                            | Description                        |
| ----------------------------------- | ---------------------------------- |
| `ProcessOrder.resume(execId)`       | Resume suspended workflow          |
| `ProcessOrder.executionId(payload)` | Compute deterministic execution ID |
| `ProcessOrder.withCompensation`     | Add saga compensation logic        |

### Handler primitives — import upstream directly

```ts
// v4
import { Activity, DurableDeferred, DurableClock } from "effect/unstable/workflow";
// v3
import { Activity, DurableDeferred, DurableClock } from "@effect/workflow";
```

No re-exports from effect-encore. Users import handler primitives from upstream directly.

## Handle

### Entity handlers — Actor.toLayer

```ts
// Consumer + producer — registers handlers AND provides Context
const CounterLive = Actor.toLayer(Counter, {
  Increment: ({ operation }) => Effect.succeed(operation.amount + 1),
  GetCount: () => Effect.succeed(42),
});

// From Effect context (yield services)
const CounterLive = Actor.toLayer(
  Counter,
  Effect.gen(function* () {
    const db = yield* Database;
    return {
      Increment: ({ operation }) => db.increment(operation.amount),
      GetCount: () => db.getCount(),
    };
  }),
);
```

### Workflow handler — Actor.toLayer

```ts
const ProcessOrderLive = Actor.toLayer(ProcessOrder, (payload) =>
  Effect.gen(function* () {
    const validated = yield* Activity.make({
      name: "Validate",
      success: Schema.String,
      execute: validateOrder(payload.orderId),
    });
    return { orderId: payload.orderId, status: "ok" };
  }),
);
```

### Producer-only (client layer)

For services that send messages to actors they don't handle:

```ts
const CounterClient = Actor.toLayer(Counter);
```

### HandlerOptions (entity only)

```ts
Actor.toLayer(actor, handlers, {
  spanAttributes: { team: "platform" },
  maxIdleTime: 60_000,
  concurrency: 10,
  mailboxCapacity: 100,
});
```

### Handler shape (entity)

Handlers receive `{ operation, request }`:

- `operation` — typed operation value with `_tag` and payload fields spread
- `request` — cluster request metadata (headers, requestId, etc.)

## Client

### actor(id) — get a ref

```ts
const ref = yield * Counter.actor("counter-1");
```

Requires `Counter.Context` in the environment (provided by `Actor.toLayer` or `Actor.toTestLayer`).

### call — block for reply

```ts
const result = yield * ref.call(Counter.Increment({ amount: 5 }));
```

Return type inferred from operation's `success` schema. Error type from `error` schema.

### cast — fire-and-forget with ExecId

```ts
const execId = yield * ref.cast(Counter.Increment({ amount: 5 }));
// execId: ExecId<number, never> — branded string with phantom types
```

Returns `ExecId<Success, Error>` immediately. Cast error channel does NOT include handler errors (discard semantics).

### ExecId

```ts
type ExecId<Success = unknown, Error = unknown> = string & {
  readonly [ExecIdBrand]: { readonly success: Success; readonly error: Error };
};
```

At runtime, just a string. Format:

- Entity: `"entityId:operationTag:primaryKey"` (opaque — don't parse)
- Workflow: upstream `idempotencyKey(payload)` result

## Peek

### peek — one-shot status check

```ts
// On the actor object — takes ExecId, returns typed PeekResult
const status = yield * Counter.peek(execId);
// status: PeekResult<number, never> — types flow from ExecId brand
```

Entity peek requires `MessageStorage | Sharding` in context.
Workflow peek requires `WorkflowEngine` in context.

### watch — polling stream

```ts
const stream = Counter.watch(execId, { interval: Duration.millis(200) });
```

Emits on status changes, completes on terminal result.

### PeekResult

```ts
type PeekResult<A = unknown, E = unknown> =
  | { _tag: "Pending" }
  | { _tag: "Success"; value: A }
  | { _tag: "Failure"; error: E }
  | { _tag: "Interrupted" }
  | { _tag: "Defect"; cause: unknown }
  | { _tag: "Suspended" }; // workflow-only at runtime
```

Guards: `isPending`, `isSuccess`, `isFailure`, `isSuspended`, `isTerminal`.

## Test

### Entity test — Actor.toTestLayer

```ts
const CounterTest = Layer.provide(
  Actor.toTestLayer(Counter, {
    Increment: ({ operation }) => Effect.succeed(operation.amount + 1),
    GetCount: () => Effect.succeed(42),
  }),
  TestShardingConfig,
);

const test = it.scopedLive.layer(CounterTest);

test("increments", () =>
  Effect.gen(function* () {
    const ref = yield* Counter.actor("counter-1");
    const result = yield* ref.call(Counter.Increment({ amount: 5 }));
    expect(result).toBe(6);
  }));
```

### Workflow test — Actor.toTestLayer

`WorkflowEngine.layerMemory` provided automatically:

```ts
const GreeterTest = Actor.toTestLayer(Greeter, (payload) =>
  Effect.succeed(`hello ${payload.name}`),
);

it.scopedLive.layer(GreeterTest)("greets", () =>
  Effect.gen(function* () {
    const ref = yield* Greeter.actor("g-1");
    const result = yield* ref.call(Greeter.Run({ name: "world" }));
    expect(result).toBe("hello world");
  }),
);
```

### Dynamic / inline test layers

Provide the layer around the **full usage** — don't let `ActorRef` escape the provider scope:

```ts
it.scopedLive("dynamic test", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<string>>([]);

    const Tracker = Actor.fromEntity("Tracker", {
      Track: {
        payload: { item: Schema.String },
        success: Schema.String,
        primaryKey: (p) => p.item,
      },
    });

    const TrackerTest = Layer.provide(
      Actor.toTestLayer(Tracker, {
        Track: ({ operation }) =>
          Ref.update(calls, (arr) => [...arr, operation.item]).pipe(
            Effect.as(`tracked: ${operation.item}`),
          ),
      }),
      TestShardingConfig,
    );

    return yield* Effect.gen(function* () {
      const ref = yield* Tracker.actor("t-1");
      const result = yield* ref.call(Tracker.Track({ item: "widget" }));
      expect(result).toBe("tracked: widget");
    }).pipe(Effect.provide(TrackerTest));
  }),
);
```

### Scope gotcha

`Effect.provide(effect, scopedLayer)` creates a private scope. If you provide only around `actor("id")`, the ref escapes the scope → "All fibers interrupted without error". Provide around the entire block.

## Lifecycle

```ts
// Entity: passivate
Order.interrupt("ord-1");

// Workflow: cancel + resume
ProcessOrder.interrupt("exec-id");
ProcessOrder.resume("exec-id");

// Workflow-only
const execId = yield * ProcessOrder.executionId({ orderId: "ord-1" });
const compensated = ProcessOrder.withCompensation(activity, (value, cause) => rollback(value));
```

## DeliverAt

```ts
const Scheduled = Actor.fromEntity("Scheduled", {
  Process: {
    payload: { id: Schema.String, deliverAt: Schema.DateTimeUtc },
    primaryKey: (p) => p.id,
    deliverAt: (p) => p.deliverAt,
    persisted: true,
  },
});
```

## Observability

Cluster creates spans `EntityType(entityId).RpcTag` automatically. No custom middleware needed. Pass extra attributes via `HandlerOptions.spanAttributes`.

## v3

Import from `effect-encore/v3`. Same API, different import paths:

| v4                         | v3                   |
| -------------------------- | -------------------- |
| `effect/unstable/cluster`  | `@effect/cluster`    |
| `effect/unstable/rpc`      | `@effect/rpc`        |
| `effect/unstable/workflow` | `@effect/workflow`   |
| `Schema.Top`               | `Schema.Schema.Any`  |
| `Context.Service`          | `Context.GenericTag` |

## Migration

### From raw @effect/cluster

| Before (raw cluster)                                                | After (effect-encore)                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Custom `Schema.Class` with `PrimaryKey.symbol` + `DeliverAt.symbol` | `primaryKey` + `deliverAt` in OperationDef                 |
| `Rpc.make` + `RpcGroup.make` + `Entity.fromRpcGroup`                | `Actor.fromEntity(name, operations)`                       |
| `entity.toLayer(Effect.gen(...))` with `entity.of({...})`           | `Actor.toLayer(actor, handlers)`                           |
| `Context.Tag` + `makeClientLayer` per entity                        | `Actor.toLayer(actor)` — provides `actor.Context`          |
| `client(entityId).Op(payload, { discard: true })`                   | `ref.cast(Actor.Op(payload))` — returns `ExecId<S, E>`     |
| Manual `getMessageStatus(primaryKey)` with empty address fields     | `actor.peek(execId)` with correct compound key             |
| Custom `RpcMiddleware` for spans                                    | Not needed — cluster creates spans automatically           |
| `Entity.makeTestClient` + manual RpcClient mapping                  | `Actor.toTestLayer(actor, handlers)` — returns typed Layer |
| `Workflow.make` + manual client wiring                              | `Actor.fromWorkflow(name, def)` — unified call site        |

### From effect-encore v1 (Actor.make era)

| Before                           | After                                        |
| -------------------------------- | -------------------------------------------- |
| `Actor.make("Name", defs)`       | `Actor.fromEntity("Name", defs)`             |
| `primaryKey` optional            | `primaryKey` mandatory on all operations     |
| `ref.cast(op)` → `CastReceipt`   | `ref.cast(op)` → `ExecId<S, E>`              |
| `peek(actor, receipt)`           | `actor.peek(execId)`                         |
| `watch(actor, receipt)`          | `actor.watch(execId)`                        |
| `import { Workflow } from "..."` | Import `Activity`/`DurableDeferred` upstream |
| `Workflow.workflow(name, opts)`  | `Actor.fromWorkflow(name, def)`              |
