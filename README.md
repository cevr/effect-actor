# effect-encore

Erlang gen_server semantics over `@effect/cluster`.

```bash
bun add effect-encore
```

Peer dependency: `effect >= 4.0.0-beta.46`.
For v3 `@effect/cluster` compat: `import { Actor } from "effect-encore/v3"`.

## Why

`@effect/cluster` entities require custom `Schema.Class`, `Rpc.make`, `RpcGroup`, `Entity.make`, handler wiring, and a hand-rolled client service. effect-encore compresses this into a declarative DSL.

## Core API

### Entity — reactive message handlers

```ts
import { Actor } from "effect-encore";
import { Schema } from "effect";

const Order = Actor.fromEntity("Order", {
  Place: {
    payload: { item: Schema.String, qty: Schema.Number },
    success: Schema.String,
    primaryKey: (p) => `${p.item}-${p.qty}`,
  },
  Cancel: {
    payload: { reason: Schema.String },
    primaryKey: (p) => p.reason,
  },
});
```

### Workflow — durable multi-step processes

```ts
const ProcessOrder = Actor.fromWorkflow("ProcessOrder", {
  payload: { orderId: Schema.String },
  success: OrderResult,
  error: OrderError,
  idempotencyKey: (p) => p.orderId,
});
```

### Unified Call Site

Both entities and workflows share the same `ref.call` / `ref.cast` interface:

```ts
// Entity
const ref = yield * Order.actor("ord-1");
const result = yield * ref.call(Order.Place({ item: "widget", qty: 3 }));
const execId = yield * ref.cast(Order.Place({ item: "widget", qty: 3 }));

// Workflow — identical call site
const ref = yield * ProcessOrder.actor("ord-1");
const result = yield * ref.call(ProcessOrder.Run({ orderId: "ord-1" }));
const execId = yield * ref.cast(ProcessOrder.Run({ orderId: "ord-1" }));
```

### Peek & Watch

Track execution status via opaque `ExecId`:

```ts
const execId = yield * ref.cast(Order.Place({ item: "widget", qty: 3 }));

// one-shot status check
const status = yield * Order.peek(execId);
// → Pending | Success | Failure | Interrupted | Defect | Suspended

// polling stream
const stream = Order.watch(execId);

// compute ExecId without executing
const id = yield * Order.executionId("ord-1", Order.Place({ item: "widget", qty: 3 }));
```

### Handle

```ts
// Entity handlers — per operation
const OrderLive = Actor.toLayer(Order, {
  Place: ({ operation }) => Effect.succeed(`order: ${operation.item} x${operation.qty}`),
  Cancel: ({ operation }) => cancelOrder(operation.reason),
});

// Workflow handler — single body with Activities
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

### Producer-Only (Client Layer)

```ts
const OrderClient = Actor.toLayer(Order);
```

### Test

```ts
const OrderTest = Actor.toTestLayer(Order, {
  Place: ({ operation }) => Effect.succeed(`order: ${operation.item}`),
  Cancel: () => Effect.void,
});

const ProcessOrderTest = Actor.toTestLayer(ProcessOrder, (payload) =>
  Effect.succeed({ orderId: payload.orderId, status: "ok" }),
);

const test = it.scopedLive.layer(Layer.provide(OrderTest, TestShardingConfig));

test("places an order", () =>
  Effect.gen(function* () {
    const ref = yield* Order.actor("ord-1");
    const result = yield* ref.call(Order.Place({ item: "widget", qty: 1 }));
    expect(result).toBe("order: widget");
  }));
```

### Lifecycle

```ts
// Workflow: cancel + resume
ProcessOrder.interrupt("ord-1");
ProcessOrder.resume("ord-1");
```

### Delayed Delivery

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

### Workflow Primitives

Import from upstream directly:

```ts
// v4
import { Activity, DurableDeferred, DurableClock, Workflow } from "effect/unstable/workflow";
// v3
import { Activity, DurableDeferred, DurableClock, Workflow } from "@effect/workflow";
```

## License

MIT
