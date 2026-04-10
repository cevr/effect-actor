import { describe, expect, it } from "effect-bun-test";
import type { Layer } from "effect";
import { Effect, Exit, Schema, Stream } from "effect";
import { ShardingConfig, TestRunner } from "effect/unstable/cluster";
import { Actor, Peek, Receipt, Testing } from "../src/index.js";

const TestShardingConfig = ShardingConfig.layer({
  shardsPerGroup: 300,
  entityMailboxCapacity: 10,
  entityTerminationTimeout: 0,
});

const test = it.scopedLive.layer(TestShardingConfig);

class ValidationError extends Schema.TaggedErrorClass<ValidationError>()("ValidationError", {
  message: Schema.String,
}) {}

const Validator = Actor.make("Validator", {
  Validate: {
    payload: { input: Schema.String },
    success: Schema.String,
    error: ValidationError,
  },
});

const validatorHandlers = Validator.entity.toLayer({
  Validate: (request) =>
    request.payload.input === "bad"
      ? Effect.fail(new ValidationError({ message: "invalid input" }))
      : Effect.succeed(`validated: ${request.payload.input}`),
}) as unknown as Layer.Layer<never>;

describe("Ref.call", () => {
  test("sends message and awaits handler completion — returns success value", () =>
    Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(Validator, validatorHandlers);
      const ref = yield* makeRef("v-1");
      const result = yield* ref["Validate"]!.call({ input: "good" });
      expect(result).toBe("validated: good");
    }));

  test("surfaces handler errors in the error channel", () =>
    Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(Validator, validatorHandlers);
      const ref = yield* makeRef("v-1");
      const exit = yield* ref["Validate"]!.call({ input: "bad" }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }));

  test("surfaces handler defects as defects", () =>
    Effect.gen(function* () {
      const BoomActor = Actor.make("Boom", {
        Explode: { success: Schema.Void },
      });
      const boomHandlers = BoomActor.entity.toLayer({
        Explode: () => Effect.die("kaboom"),
      }) as unknown as Layer.Layer<never>;

      const makeRef = yield* Testing.testClient(BoomActor, boomHandlers);
      const ref = yield* makeRef("b-1");
      const exit = yield* ref["Explode"]!.call().pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }));

  test("works without MessageStorage (non-persisted path)", () =>
    Effect.gen(function* () {
      const VolatileActor = Actor.make("Volatile", {
        Ping: { success: Schema.String },
      });
      const volatileHandlers = VolatileActor.entity.toLayer({
        Ping: () => Effect.succeed("pong"),
      }) as unknown as Layer.Layer<never>;

      const makeRef = yield* Testing.testClient(VolatileActor, volatileHandlers);
      const ref = yield* makeRef("vol-1");
      const result = yield* ref["Ping"]!.call();
      expect(result).toBe("pong");
    }));
});

const CastActor = Actor.make("CastActor", {
  Process: {
    payload: { input: Schema.String },
    success: Schema.String,
    persisted: true,
    primaryKey: (p: { input: string }) => p.input,
  },
});

const castHandlers = CastActor.entity.toLayer({
  Process: (request) => Effect.succeed(`processed: ${request.payload.input}`),
}) as unknown as Layer.Layer<never>;

describe("Ref.cast", () => {
  test("sends persisted message with discard: true — returns CastReceipt immediately", () =>
    Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(CastActor, castHandlers);
      const ref = yield* makeRef("c-1");
      const receipt = yield* ref["Process"]!.cast({ input: "data" });
      expect(receipt._tag).toBe("CastReceipt");
    }));

  test("receipt contains actorType, entityId, operation, primaryKey", () =>
    Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(CastActor, castHandlers);
      const ref = yield* makeRef("c-2");
      const receipt = yield* ref["Process"]!.cast({ input: "mykey" });
      expect(receipt.actorType).toBe("CastActor");
      expect(receipt.entityId).toBe("c-2");
      expect(receipt.operation).toBe("Process");
      expect(receipt.primaryKey).toBe("mykey");
    }));

  test("cast without primaryKey returns receipt with no primaryKey", () =>
    Effect.gen(function* () {
      const SimpleActor = Actor.make("Simple", {
        Do: {
          payload: { x: Schema.Number },
          success: Schema.Number,
          persisted: true,
        },
      });
      const simpleHandlers = SimpleActor.entity.toLayer({
        Do: (req) => Effect.succeed(req.payload.x * 2),
      }) as unknown as Layer.Layer<never>;

      const makeRef = yield* Testing.testClient(SimpleActor, simpleHandlers);
      const ref = yield* makeRef("s-1");
      const receipt = yield* ref["Do"]!.cast({ x: 5 });
      expect(receipt.primaryKey).toBeUndefined();
    }));

  test("cast still returns CastReceipt even without cluster persistence", () =>
    Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(CastActor, castHandlers);
      const ref = yield* makeRef("c-persist-1");
      const receipt = yield* ref["Process"]!.cast({ input: "test" });
      expect(receipt._tag).toBe("CastReceipt");
      expect(receipt.primaryKey).toBe("test");
    }));
});

describe("Ref.watch", () => {
  it.scopedLive("emits Pending then Success when handler completes, then completes stream", () =>
    Effect.gen(function* () {
      const makeClient = yield* CastActor.entity.client;
      const client = makeClient("w-1");

      yield* client.Process({ input: "watch-test" }, { discard: true });

      const receipt = Receipt.makeCastReceipt({
        actorType: "CastActor",
        entityId: "w-1",
        operation: "Process",
        primaryKey: "watch-test",
      });

      const result = yield* Peek.watch(CastActor, receipt, {
        interval: "50 millis",
      }).pipe(Stream.runCollect);

      const arr = Array.from(result);
      expect(arr.length).toBeGreaterThan(0);
      const last = arr[arr.length - 1]!;
      expect(last._tag).toBe("Success");
      if (last._tag === "Success") {
        expect(last.value).toBe("processed: watch-test");
      }
    }).pipe(Effect.provide(castHandlers), Effect.provide(TestRunner.layer)),
  );
});

describe("single-operation ref", () => {
  test("call/cast are directly on ref — no operation namespace", () =>
    Effect.gen(function* () {
      const SingleActor = Actor.single("SingleOp", {
        payload: { n: Schema.Number },
        success: Schema.Number,
        persisted: true,
        primaryKey: (p: { n: number }) => String(p.n),
      });

      const singleHandlers = SingleActor.entity.toLayer({
        SingleOp: (req) => Effect.succeed(req.payload.n * 3),
      }) as unknown as Layer.Layer<never>;

      const makeRef = yield* Testing.testSingleClient(SingleActor, singleHandlers);
      const ref = yield* makeRef("single-1");
      const result = yield* ref.call({ n: 5 });
      expect(result).toBe(15);
    }));
});
