# effect-encore

Erlang gen_server semantics over `@effect/cluster`.

## Why

`@effect/cluster` is powerful but low-level. Defining a single entity requires custom `Schema.Class` implementations, `Rpc.make`, `RpcGroup`, `Entity.make`, handler wiring via `entity.toLayer`, and a hand-rolled client service. A typical entity runs 100+ lines before any business logic.

effect-encore compresses this into a declarative DSL:

```ts
import { Actor } from "effect-encore";
import { Schema } from "effect";

const Counter = Actor.make("Counter", {
  Increment: {
    payload: { amount: Schema.Number },
    success: Schema.Number,
  },
  GetCount: {
    success: Schema.Number,
  },
});
```

Every operation supports `call` (block for reply) and `cast` (fire-and-forget with receipt). Delivery mode is the caller's choice, not the definition's — just like Erlang's `gen_server:call` vs `gen_server:cast`.

## Core API

### Define

```ts
const Order = Actor.make("Order", {
  Place: {
    payload: { item: Schema.String, qty: Schema.Number },
    success: Schema.String,
    error: OrderError,
    persisted: true,
    primaryKey: (p) => p.item,
  },
  Cancel: {
    payload: { reason: Schema.String },
    persisted: true,
    primaryKey: (p) => p.reason,
  },
});
```

Operation constructors are on the object directly:

```ts
Order.Place({ item: "widget", qty: 3 }); // → OperationValue
Order.Cancel({ reason: "changed mind" });
```

### Handle

```ts
// Consumer + producer layer — registers entity handlers AND provides Order.Context
const OrderLive = Actor.toLayer(Order, {
  Place: ({ operation }) => Effect.succeed(`order: ${operation.item} x${operation.qty}`),
  Cancel: ({ operation }) => cancelOrder(operation.reason),
});

// With Effect context for dependency injection
const OrderLive = Actor.toLayer(
  Order,
  Effect.gen(function* () {
    const db = yield* Database;
    return {
      Place: ({ operation }) => db.placeOrder(operation.item, operation.qty),
      Cancel: ({ operation }) => db.cancel(operation.reason),
    };
  }),
);
```

### Call & Cast

```ts
// Get a ref to an actor instance
const ref = yield * Order.actor("order-123");

// call — block for reply
const result = yield * ref.call(Order.Place({ item: "widget", qty: 3 }));

// cast — fire-and-forget, get receipt
const receipt = yield * ref.cast(Order.Place({ item: "widget", qty: 3 }));
```

### Peek & Watch

```ts
// peek — one-shot status check via receipt
const status = yield * peek(Order, receipt);

// watch — polling stream of status changes
const stream = watch(Order, receipt);
```

### Producer-Only (Client Layer)

For services that send messages to actors they don't handle:

```ts
// No handlers — just provides Order.Context for sending
const OrderClient = Actor.toLayer(Order);
```

### Test

```ts
// Actor.toTestLayer provides the same Context tag — call sites are identical
const OrderTest = Actor.toTestLayer(Order, {
  Place: ({ operation }) => Effect.succeed(`order: ${operation.item}`),
  Cancel: () => Effect.void,
});

// Compose with test infra
const test = it.scopedLive.layer(Layer.provide(OrderTest, TestShardingConfig));

test("places an order", () =>
  Effect.gen(function* () {
    const ref = yield* Order.actor("ord-1");
    const result = yield* ref.call(Order.Place({ item: "widget", qty: 1 }));
    expect(result).toBe("order: widget");
  }));
```

### Delayed Delivery

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

### Pre-built Schema.Class

Escape hatch for custom symbol implementations:

```ts
const WithCustomPayload = Actor.make("Custom", {
  Run: { payload: MySchemaClass, success: Schema.Void },
});
```

## v3 Support

Import from `effect-encore/v3` for `@effect/cluster` v3 compatibility. Same API, different import paths under the hood.

## Install

```bash
bun add effect-encore
```

Peer dependencies: `effect`, `@effect/cluster` (v3) or `effect` with `effect/unstable/cluster` (v4).

## License

MIT
