import { describe, expect, it } from "effect-bun-test";
import type { Layer } from "effect";
import { Effect, Exit, Schema } from "effect";
import { ShardingConfig } from "effect/unstable/cluster";
import { Actor, Testing } from "../src/index.js";

const TestShardingConfig = ShardingConfig.layer({
  shardsPerGroup: 300,
  entityMailboxCapacity: 10,
  entityTerminationTimeout: 0,
});

const test = it.scopedLive.layer(TestShardingConfig);

const Counter = Actor.make("Counter", {
  Increment: {
    payload: { amount: Schema.Number },
    success: Schema.Number,
  },
  GetCount: {
    success: Schema.String,
  },
});

const handlerLayer = Counter.entity.toLayer({
  Increment: (request) => Effect.succeed(request.payload.amount + 1),
  GetCount: () => Effect.succeed("hello"),
}) as unknown as Layer.Layer<never>;

describe("Actor.handlers", () => {
  test("wires plain handler functions — call returns handler result", () =>
    Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(Counter, handlerLayer);
      const ref = yield* makeRef("counter-1");
      const result = yield* ref["Increment"]!.call({ amount: 5 });
      expect(result).toBe(6);
    }));

  test("handler return value becomes the RPC reply — no explicit .reply()", () =>
    Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(Counter, handlerLayer);
      const ref = yield* makeRef("counter-1");
      const result = yield* ref["GetCount"]!.call();
      expect(result).toBe("hello");
    }));

  test("supports Effect.succeed for handlers that need deferred construction", () =>
    Effect.gen(function* () {
      const GenActor = Actor.make("GenActor", {
        Compute: {
          payload: { x: Schema.Number },
          success: Schema.Number,
        },
      });

      const genHandlers = GenActor.entity.toLayer(
        Effect.succeed({
          Compute: (req) => Effect.succeed(req.payload.x * 10),
        } as const),
      ) as unknown as Layer.Layer<never>;

      const makeRef = yield* Testing.testClient(GenActor, genHandlers);
      const ref = yield* makeRef("gen-1");
      const result = yield* ref["Compute"]!.call({ x: 7 });
      expect(result).toBe(70);
    }));

  test("handler errors become RPC errors", () =>
    Effect.gen(function* () {
      class HandlerError extends Schema.TaggedErrorClass<HandlerError>()("HandlerError", {
        reason: Schema.String,
      }) {}

      const ErrActor = Actor.make("ErrActor", {
        Fail: {
          payload: { input: Schema.String },
          success: Schema.Void,
          error: HandlerError,
        },
      });

      const errHandlers = ErrActor.entity.toLayer({
        Fail: (_req) => Effect.fail(new HandlerError({ reason: "bad" })),
      }) as unknown as Layer.Layer<never>;

      const makeRef = yield* Testing.testClient(ErrActor, errHandlers);
      const ref = yield* makeRef("err-1");
      const exit = yield* ref["Fail"]!.call({ input: "test" }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }));

  test("handler receives request with payload", () =>
    Effect.gen(function* () {
      let receivedPayload: unknown = null;

      const InspectActor = Actor.make("InspectActor", {
        Inspect: {
          payload: { value: Schema.String },
          success: Schema.String,
        },
      });

      const inspectHandlers = InspectActor.entity.toLayer({
        Inspect: (req) => {
          receivedPayload = req.payload;
          return Effect.succeed(`got: ${req.payload.value}`);
        },
      }) as unknown as Layer.Layer<never>;

      const makeRef = yield* Testing.testClient(InspectActor, inspectHandlers);
      const ref = yield* makeRef("inspect-1");
      const result = yield* ref["Inspect"]!.call({ value: "hello" });
      expect(result).toBe("got: hello");
      expect(receivedPayload).toEqual({ value: "hello" });
    }));
});
