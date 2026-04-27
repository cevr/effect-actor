import { describe, expect, it } from "effect-bun-test/v3";
import { Effect, Schema } from "effect";
import { TestRunner } from "@effect/cluster";
import { Actor } from "../src/index.js";

const FlushActor = Actor.fromEntity("FlushActor", {
  Process: {
    payload: { input: Schema.String },
    success: Schema.String,
    persisted: true,
    // entityId === primaryKey === input
    id: (p: { input: string }) => p.input,
  },
});

const flushHandlers = Actor.toLayer(FlushActor, {
  Process: ({ operation }) => Effect.succeed(`done: ${operation.input}`),
});

const TestCluster = TestRunner.layer;

describe("Actor.flush", () => {
  it.scopedLive("clears all messages for the entity", () =>
    Effect.gen(function* () {
      const makeClient = yield* FlushActor._meta.entity.client;
      const client = makeClient("hello");
      yield* client.Process({ input: "hello" });

      const before = yield* FlushActor.Process.peek({ input: "hello" });
      expect(before._tag).toBe("Success");

      yield* FlushActor.flush("hello");

      const after = yield* FlushActor.Process.peek({ input: "hello" });
      expect(after._tag).toBe("Pending");
    }).pipe(Effect.provide(flushHandlers), Effect.provide(TestCluster)),
  );

  it.scopedLive("preserves other entities' messages", () =>
    Effect.gen(function* () {
      const makeClient = yield* FlushActor._meta.entity.client;

      const clientA = makeClient("a");
      yield* clientA.Process({ input: "a" });
      const clientB = makeClient("b");
      yield* clientB.Process({ input: "b" });

      yield* FlushActor.flush("a");

      const flushed = yield* FlushActor.Process.peek({ input: "a" });
      expect(flushed._tag).toBe("Pending");

      const kept = yield* FlushActor.Process.peek({ input: "b" });
      expect(kept._tag).toBe("Success");
    }).pipe(Effect.provide(flushHandlers), Effect.provide(TestCluster)),
  );
});

const RedeliverActor = Actor.fromEntity("RedeliverActor", {
  Process: {
    payload: { input: Schema.String },
    success: Schema.String,
    persisted: true,
    id: (p: { input: string }) => p.input,
  },
});

const redeliverHandlers = Actor.toLayer(RedeliverActor, {
  Process: ({ operation }) => Effect.succeed(`done: ${operation.input}`),
});

describe("Actor.redeliver", () => {
  it.scopedLive("completes without error on processed messages", () =>
    Effect.gen(function* () {
      const makeClient = yield* RedeliverActor._meta.entity.client;
      const client = makeClient("test");
      yield* client.Process({ input: "test" });

      const result = yield* RedeliverActor.Process.peek({ input: "test" });
      expect(result._tag).toBe("Success");

      // Redeliver resets read leases on unprocessed messages
      yield* RedeliverActor.redeliver("test");

      // Already-processed message should still show Success
      const after = yield* RedeliverActor.Process.peek({ input: "test" });
      expect(after._tag).toBe("Success");
    }).pipe(Effect.provide(redeliverHandlers), Effect.provide(TestCluster)),
  );
});
