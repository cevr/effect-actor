---
name: effect-encore
description: Erlang gen_server semantics over @effect/cluster. Use when building actor/entity definitions with effect-encore, wiring handlers, writing call/cast/peek/watch patterns, testing actors, or migrating from raw @effect/cluster Entity/Rpc/RpcGroup code.
---

# effect-encore

Thin protocol layer over `@effect/cluster` providing Erlang gen_server semantics.

## Navigation

```
What are you working on?
├─ Defining an actor              → §Define
├─ Wiring handlers / layers       → §Handle
├─ Calling / casting              → §Client
├─ Checking results (peek/watch)  → §Peek
├─ Testing                        → §Test
├─ Delayed delivery (deliverAt)   → §DeliverAt
├─ Workflows                      → §Workflow
├─ Observability                  → §Observability
├─ v3 compatibility               → §v3
└─ Migrating from raw cluster     → §Migration
```

## Core Concepts

- **Delivery mode is the caller's choice.** Every operation supports `call` and `cast`. The definition doesn't decide — the caller does.
- **Value dispatch.** Construct an operation value, pass it to `ref.call(op)` or `ref.cast(op)`.
- **One layer, two roles.** `Actor.toLayer(actor, handlers)` = consumer + producer. `Actor.toLayer(actor)` = producer only.
- **Compiles to @effect/cluster.** Not a new runtime. `Actor.make` produces an `Entity` under the hood.

## Define

### Multi-operation actor

```ts
const Counter = Actor.make("Counter", {
  Increment: {
    payload: { amount: Schema.Number },
    success: Schema.Number,
  },
  GetCount: {
    success: Schema.Number,
  },
});

// Constructors are on the object directly
Counter.Increment({ amount: 5 }); // → OperationValue
Counter.GetCount(); // zero-input, still callable
```

### OperationDef fields

| Field        | Type                                 | Default         | Description                             |
| ------------ | ------------------------------------ | --------------- | --------------------------------------- |
| `payload`    | `Schema.Top \| Schema.Struct.Fields` | `Schema.Void`   | Inline fields or pre-built Schema.Class |
| `success`    | `Schema.Top`                         | `Schema.Void`   | Success response schema                 |
| `error`      | `Schema.Top`                         | `Schema.Never`  | Error schema                            |
| `persisted`  | `boolean`                            | cluster default | Persist to MessageStorage               |
| `primaryKey` | `(payload) => string`                | none            | Deduplication key extractor             |
| `deliverAt`  | `(payload) => DateTime`              | none            | Delayed delivery extractor              |

### ActorObject properties

| Property                    | Type        | Description                               |
| --------------------------- | ----------- | ----------------------------------------- |
| `Counter.Increment(...)`    | Constructor | Returns `OperationValue`                  |
| `Counter._meta.name`        | `"Counter"` | Actor name (literal type)                 |
| `Counter._meta.entity`      | `Entity`    | Underlying cluster Entity                 |
| `Counter._meta.definitions` | Record      | Raw operation definitions                 |
| `Counter.Context`           | Context tag | DI tag for client factory                 |
| `Counter.actor(id)`         | Method      | `yield* Counter.actor("id")` → `ActorRef` |
| `Counter.$is(tag)`          | Type guard  | `Counter.$is("Increment")(value)`         |

### Reserved operation names

`_tag`, `_meta`, `$is`, `Context`, `actor` — these collide with ActorObject properties. Compile-time type guard + runtime check.

### Pre-built Schema.Class payload

When you need full control (custom symbols, complex types), pass a `Schema.Class` directly. The `primaryKey`/`deliverAt` options are ignored — symbols must be on the class.

```ts
class CustomPayload extends Schema.Class<CustomPayload>("CustomPayload")({
  id: Schema.String,
  when: Schema.DateTimeUtc,
}) {
  [PrimaryKey.symbol]() {
    return this.id;
  }
  [DeliverAt.symbol]() {
    return this.when;
  }
}

const MyActor = Actor.make("MyActor", {
  Run: { payload: CustomPayload, success: Schema.Void, persisted: true },
});
```

### Escape hatch: raw Rpcs

```ts
const MyActor = fromRpcs("MyActor", [
  Rpc.make("Op1", { ... }),
  Rpc.make("Op2", { ... }),
]);
```

## Handle

### Actor.toLayer — consumer + producer

Registers entity handlers AND provides the actor's `Context` tag (client factory).

```ts
// Plain object
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

### Actor.toLayer — producer only

For services that send messages to actors they don't handle (remote entities):

```ts
const CounterClient = Actor.toLayer(Counter);
```

### HandlerOptions

```ts
Actor.toLayer(actor, handlers, {
  spanAttributes: { team: "platform" },
  maxIdleTime: 60_000,
  concurrency: 10,
  mailboxCapacity: 100,
});
```

### Handler shape

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

Return type is inferred from the operation's `success` schema. Error type from `error` schema.

### cast — fire-and-forget

```ts
const receipt = yield * ref.cast(Counter.Increment({ amount: 5 }));
```

Returns `CastReceipt` immediately. Cast error channel does NOT include handler errors (discard semantics).

### CastReceipt

```ts
type CastReceipt = {
  _tag: "CastReceipt";
  actorType: string;
  entityId: string;
  operation: string;
  primaryKey?: string;
};
```

## Peek

One-shot status check via CastReceipt. Requires `MessageStorage | Sharding` in context.

```ts
const status = yield * peek(Counter, receipt);
// Returns: Pending | Success | Failure | Interrupted | Defect
```

### Watch

Polling stream that emits on status changes and completes on terminal result.

```ts
const stream = watch(Counter, receipt, { interval: Duration.millis(200) });
```

### Gotchas

- `peek` requires a real `primaryKey` on the operation. Cast without `primaryKey` works but the receipt is NOT peekable.
- `peek` uses `actor._meta.name` (not `receipt.actorType`) for EntityAddress lookup.

## Test

### Actor.toTestLayer — layer-based testing

Returns a `Layer` that provides the actor's `Context` tag via `Entity.makeTestClient` — no cluster infrastructure needed.

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

### Dynamic / inline test layers

When you need to create actors or capture refs inside a test body, provide the layer around the **full usage** — don't let `ActorRef` escape the provider scope:

```ts
it.scopedLive("dynamic test", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Array<string>>([]);

    const Tracker = Actor.make("Tracker", {
      Track: { payload: { item: Schema.String }, success: Schema.String },
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

    // Provide around the FULL usage, not just actor()
    return yield* Effect.gen(function* () {
      const ref = yield* Tracker.actor("t-1");
      const result = yield* ref.call(Tracker.Track({ item: "widget" }));
      expect(result).toBe("tracked: widget");
    }).pipe(Effect.provide(TrackerTest));
  }),
);
```

### Scope gotcha

`Effect.provide(effect, scopedLayer)` creates a private scope that closes when `effect` completes. `Actor.toTestLayer` is scoped (uses `Entity.makeTestClient` which needs `Scope`). If you `Effect.provide` it around only `actor("id")`, the ref escapes the scope and points at dead resources → "All fibers interrupted without error".

**Fix**: provide around the entire block that uses the ref, or use `Layer.buildWithScope` to pin to the test's ambient scope.

### Full cluster integration test

For tests needing `Sharding`, `MessageStorage`, etc., use `TestRunner.layer`:

```ts
const orderHandlers = Actor.toLayer(Order, { ... });

it.scopedLive("round-trip", () =>
  Effect.gen(function* () {
    const makeClient = yield* Order._meta.entity.client;
    const client = makeClient("ord-1");
    const result = yield* client.Place({ item: "widget", qty: 3 });
  }).pipe(
    Effect.provide(orderHandlers),
    Effect.provide(TestRunner.layer),
  ),
);
```

## DeliverAt

```ts
const Scheduled = Actor.make("Scheduled", {
  Process: {
    payload: { id: Schema.String, deliverAt: Schema.DateTimeUtc },
    primaryKey: (p) => p.id,
    deliverAt: (p) => p.deliverAt,
    persisted: true,
  },
});
```

The `deliverAt` field must be in the payload schema — the extractor reads it from the payload instance. The library generates a `Schema.Class` with `DeliverAt.symbol` attached.

`deliverAt` without `primaryKey` is valid (delayed but not deduped).

## Workflow

Re-exports from `effect/unstable/workflow`:

```ts
import { Workflow } from "effect-encore";
const { DurableDeferred, Activity } = Workflow;
```

## Observability

Cluster already creates spans `EntityType(entityId).RpcTag` automatically. No custom middleware needed.

Pass extra attributes via `HandlerOptions.spanAttributes`. Access current entity address via `Observability.CurrentAddress`.

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
| `Rpc.make` + `RpcGroup.make` + `Entity.fromRpcGroup`                | `Actor.make(name, operations)`                             |
| `entity.toLayer(Effect.gen(...))` with `entity.of({...})`           | `Actor.toLayer(actor, handlers)`                           |
| `Context.Tag` + `makeClientLayer` per entity                        | `Actor.toLayer(actor)` — provides `actor.Context`          |
| `client(entityId).Op(payload, { discard: true })`                   | `ref.cast(Actor.Op(payload))` — returns `CastReceipt`      |
| Manual `getMessageStatus(primaryKey)` with empty address fields     | `peek(actor, receipt)` with correct compound key           |
| Custom `RpcMiddleware` for spans                                    | Not needed — cluster creates spans automatically           |
| `Entity.makeTestClient` + manual RpcClient mapping                  | `Actor.toTestLayer(actor, handlers)` — returns typed Layer |
