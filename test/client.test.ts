import { describe, expect, it } from "bun:test";
import { Effect, Exit, Schema } from "effect";
import { ShardingConfig } from "effect/unstable/cluster";
import { Actor, Handlers, Testing } from "../src/index.js";

const TestShardingConfig = ShardingConfig.layer({
  shardsPerGroup: 300,
  entityMailboxCapacity: 10,
  entityTerminationTimeout: 0,
});

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

const validatorHandlers = Handlers.handlers(Validator, {
  Validate: (request: { payload: { input: string } }) =>
    request.payload.input === "bad"
      ? Effect.fail(new ValidationError({ message: "invalid input" }))
      : Effect.succeed(`validated: ${request.payload.input}`),
});

describe("Ref.call", () => {
  it("sends message and awaits handler completion — returns success value", async () => {
    const result = await Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(Validator, validatorHandlers);
      const ref = yield* makeRef("v-1");
      return yield* ref.Validate.call({ input: "good" });
    }).pipe(Effect.scoped, Effect.provide(TestShardingConfig), Effect.runPromise);

    expect(result).toBe("validated: good");
  });

  it("surfaces handler errors in the error channel", async () => {
    const exit = await Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(Validator, validatorHandlers);
      const ref = yield* makeRef("v-1");
      return yield* ref.Validate.call({ input: "bad" });
    }).pipe(Effect.scoped, Effect.provide(TestShardingConfig), Effect.runPromiseExit);

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("surfaces handler defects as defects", async () => {
    const BoomActor = Actor.make("Boom", {
      Explode: { success: Schema.Void },
    });
    const boomHandlers = Handlers.handlers(BoomActor, {
      Explode: () => Effect.die("kaboom"),
    });

    const exit = await Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(BoomActor, boomHandlers);
      const ref = yield* makeRef("b-1");
      return yield* ref.Explode.call();
    }).pipe(Effect.scoped, Effect.provide(TestShardingConfig), Effect.runPromiseExit);

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it.todo("works without MessageStorage (non-persisted path)", () => {});
});

const CastActor = Actor.make("CastActor", {
  Process: {
    payload: { input: Schema.String },
    success: Schema.String,
    persisted: true,
    primaryKey: (p: { input: string }) => p.input,
  },
});

const castHandlers = Handlers.handlers(CastActor, {
  Process: (request: { payload: { input: string } }) =>
    Effect.succeed(`processed: ${request.payload.input}`),
});

describe("Ref.cast", () => {
  it("sends persisted message with discard: true — returns CastReceipt immediately", async () => {
    const receipt = await Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(CastActor, castHandlers);
      const ref = yield* makeRef("c-1");
      return yield* ref.Process.cast({ input: "data" });
    }).pipe(Effect.scoped, Effect.provide(TestShardingConfig), Effect.runPromise);

    expect(receipt._tag).toBe("CastReceipt");
  });

  it("receipt contains actorType, entityId, operation, primaryKey", async () => {
    const receipt = await Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(CastActor, castHandlers);
      const ref = yield* makeRef("c-2");
      return yield* ref.Process.cast({ input: "mykey" });
    }).pipe(Effect.scoped, Effect.provide(TestShardingConfig), Effect.runPromise);

    expect(receipt.actorType).toBe("CastActor");
    expect(receipt.entityId).toBe("c-2");
    expect(receipt.operation).toBe("Process");
    expect(receipt.primaryKey).toBe("mykey");
  });

  it("auto-generates primaryKey when payload has no PrimaryKey", async () => {
    const SimpleActor = Actor.make("Simple", {
      Do: {
        payload: { x: Schema.Number },
        success: Schema.Number,
        persisted: true,
      },
    });
    const simpleHandlers = Handlers.handlers(SimpleActor, {
      Do: (req: { payload: { x: number } }) => Effect.succeed(req.payload.x * 2),
    });

    const receipt = await Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(SimpleActor, simpleHandlers);
      const ref = yield* makeRef("s-1");
      return yield* ref.Do.cast({ x: 5 });
    }).pipe(Effect.scoped, Effect.provide(TestShardingConfig), Effect.runPromise);

    expect(receipt.primaryKey).toBeDefined();
    expect(receipt.primaryKey.length).toBeGreaterThan(0);
  });

  it.todo("requires MessageStorage in context — fails loudly without it", () => {});
});

describe("Ref.watch", () => {
  it.todo("returns Stream that polls for reply state changes", () => {});
  it.todo("emits Pending then Success when handler completes", () => {});
  it.todo("completes the stream on terminal result (Success/Failure/Interrupted/Defect)", () => {});
  it.todo("respects configurable poll interval", () => {});
});

describe("single-operation ref", () => {
  it.todo("call/cast/watch are directly on ref — no operation namespace", () => {});
});
