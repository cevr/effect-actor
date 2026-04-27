import { describe, expect, it } from "effect-bun-test";
import type { Layer } from "effect";
import { Effect, Schema } from "effect";
import { TestRunner } from "effect/unstable/cluster";
import { Actor, makeExecId } from "../src/index.js";

const FlushActor = Actor.fromEntity("FlushActor", {
  Process: {
    payload: { input: Schema.String },
    success: Schema.String,
    persisted: true,
    id: (p: { input: string }) => p.input,
  },
});

const flushHandlers = Actor.toLayer(FlushActor, {
  Process: ({ operation }) => Effect.succeed(`done: ${operation.input}`),
});

const TestCluster = TestRunner.layer;

describe("Actor.flush", () => {
  it.scopedLive("clears all messages for the actor", () =>
    Effect.gen(function* () {
      const makeClient = yield* FlushActor._meta.entity.client;
      const client = makeClient("f-1");
      yield* client.Process({ input: "hello" });

      const execId = makeExecId("f-1\x00Process\x00hello");
      const before = yield* FlushActor.peek(execId);
      expect(before._tag).toBe("Success");

      yield* FlushActor.flush("f-1");

      const after = yield* FlushActor.peek(execId);
      expect(after._tag).toBe("Pending");
    }).pipe(
      Effect.provide(flushHandlers as unknown as Layer.Layer<never>),
      Effect.provide(TestCluster),
    ),
  );

  it.scopedLive("preserves other actors' messages", () =>
    Effect.gen(function* () {
      const makeClient = yield* FlushActor._meta.entity.client;

      const client1 = makeClient("f-2a");
      yield* client1.Process({ input: "a" });
      const client2 = makeClient("f-2b");
      yield* client2.Process({ input: "b" });

      yield* FlushActor.flush("f-2a");

      const flushed = yield* FlushActor.peek(makeExecId("f-2a\x00Process\x00a"));
      expect(flushed._tag).toBe("Pending");

      const kept = yield* FlushActor.peek(makeExecId("f-2b\x00Process\x00b"));
      expect(kept._tag).toBe("Success");
    }).pipe(
      Effect.provide(flushHandlers as unknown as Layer.Layer<never>),
      Effect.provide(TestCluster),
    ),
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
      const client = makeClient("r-1");
      yield* client.Process({ input: "test" });

      const execId = makeExecId("r-1\x00Process\x00test");
      const result = yield* RedeliverActor.peek(execId);
      expect(result._tag).toBe("Success");

      // Redeliver resets read leases on unprocessed messages
      yield* RedeliverActor.redeliver("r-1");

      // Already-processed message should still show Success
      const after = yield* RedeliverActor.peek(execId);
      expect(after._tag).toBe("Success");
    }).pipe(
      Effect.provide(redeliverHandlers as unknown as Layer.Layer<never>),
      Effect.provide(TestCluster),
    ),
  );
});
