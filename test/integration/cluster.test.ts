import { describe, expect, it } from "bun:test";
import type { Layer } from "effect";
import { Effect, Schema } from "effect";
import { TestRunner } from "effect/unstable/cluster";
import { Actor, Peek, Receipt } from "../../src/index.js";

class OrderError extends Schema.TaggedErrorClass<OrderError>()("OrderError", {
  message: Schema.String,
}) {}

const OrderActor = Actor.make("Order", {
  Place: {
    payload: { item: Schema.String, qty: Schema.Number },
    success: Schema.String,
    persisted: true,
    primaryKey: (p: { item: string; qty: number }) => `${p.item}-${p.qty}`,
  },
  Cancel: {
    payload: { reason: Schema.String },
    success: Schema.Void,
    error: OrderError,
    persisted: true,
    primaryKey: (p: { reason: string }) => p.reason,
  },
  QuickCheck: {
    payload: { id: Schema.String },
    success: Schema.String,
  },
});

const orderHandlers = OrderActor.entity.toLayer({
  Place: (req) => Effect.succeed(`order: ${req.payload.item} x${req.payload.qty}`),
  Cancel: (_req) => Effect.fail(new OrderError({ message: "cannot cancel" })),
  QuickCheck: (req) => Effect.succeed(`ok: ${req.payload.id}`),
}) as unknown as Layer.Layer<never>;

const TestCluster = TestRunner.layer;

describe("cluster integration", () => {
  it("call round-trip through Entity", async () => {
    const result = await Effect.gen(function* () {
      const makeClient = yield* OrderActor.entity.client;
      const client = makeClient("ord-1");
      return yield* client.Place({ item: "widget", qty: 3 });
    }).pipe(
      Effect.provide(orderHandlers),
      Effect.provide(TestCluster),
      Effect.scoped,
      Effect.runPromise,
    );

    expect(result).toBe("order: widget x3");
  });

  it("cast -> peek round-trip with persistence", async () => {
    const result = await Effect.gen(function* () {
      const makeClient = yield* OrderActor.entity.client;
      const client = makeClient("ord-2");

      // Cast via discard: true
      yield* client.Place({ item: "gadget", qty: 1 }, { discard: true });

      // Wait for handler to complete
      yield* Effect.sleep("100 millis");

      const receipt = Receipt.makeCastReceipt({
        actorType: "Order",
        entityId: "ord-2",
        operation: "Place",
        primaryKey: "gadget-1",
      });

      return yield* Peek.peek(OrderActor, receipt);
    }).pipe(
      Effect.provide(orderHandlers),
      Effect.provide(TestCluster),
      Effect.scoped,
      Effect.runPromise,
    );

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.value).toBe("order: gadget x1");
    }
  });

  it("peek returns Pending then Success as handler completes", async () => {
    const result = await Effect.gen(function* () {
      const makeClient = yield* OrderActor.entity.client;
      const client = makeClient("ord-3");

      const receipt = Receipt.makeCastReceipt({
        actorType: "Order",
        entityId: "ord-3",
        operation: "Place",
        primaryKey: "slow-1",
      });

      // Peek before any message sent — should be Pending
      const before = yield* Peek.peek(OrderActor, receipt);
      expect(before._tag).toBe("Pending");

      // Now send the message
      yield* client.Place({ item: "slow", qty: 1 }, { discard: true });
      yield* Effect.sleep("100 millis");

      return yield* Peek.peek(OrderActor, receipt);
    }).pipe(
      Effect.provide(orderHandlers),
      Effect.provide(TestCluster),
      Effect.scoped,
      Effect.runPromise,
    );

    expect(result._tag).toBe("Success");
  });

  it("failure/defect decode correctly from WithExit", async () => {
    const result = await Effect.gen(function* () {
      const makeClient = yield* OrderActor.entity.client;
      const client = makeClient("ord-4");

      // Send a message that will fail
      yield* client.Cancel({ reason: "test-fail" }).pipe(Effect.option);

      const receipt = Receipt.makeCastReceipt({
        actorType: "Order",
        entityId: "ord-4",
        operation: "Cancel",
        primaryKey: "test-fail",
      });

      return yield* Peek.peek(OrderActor, receipt);
    }).pipe(
      Effect.provide(orderHandlers),
      Effect.provide(TestCluster),
      Effect.scoped,
      Effect.runPromise,
    );

    expect(result._tag).toBe("Failure");
  });

  it("duplicate primaryKey is idempotent", async () => {
    const result = await Effect.gen(function* () {
      const makeClient = yield* OrderActor.entity.client;
      const client = makeClient("ord-5");

      // Send same message twice with same primaryKey
      yield* client.Place({ item: "dup", qty: 1 }, { discard: true });
      yield* client.Place({ item: "dup", qty: 1 }, { discard: true });

      yield* Effect.sleep("100 millis");

      const receipt = Receipt.makeCastReceipt({
        actorType: "Order",
        entityId: "ord-5",
        operation: "Place",
        primaryKey: "dup-1",
      });

      return yield* Peek.peek(OrderActor, receipt);
    }).pipe(
      Effect.provide(orderHandlers),
      Effect.provide(TestCluster),
      Effect.scoped,
      Effect.runPromise,
    );

    // Should have a result (not crash from duplicate)
    expect(result._tag).toBe("Success");
  });

  it("non-persisted call works without MessageStorage", async () => {
    const result = await Effect.gen(function* () {
      const makeClient = yield* OrderActor.entity.client;
      const client = makeClient("ord-6");
      return yield* client.QuickCheck({ id: "fast" });
    }).pipe(
      Effect.provide(orderHandlers),
      Effect.provide(TestCluster),
      Effect.scoped,
      Effect.runPromise,
    );

    expect(result).toBe("ok: fast");
  });
});
