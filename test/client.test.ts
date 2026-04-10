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

describe("Ref.cast", () => {
  it.todo("sends persisted message with discard: true — returns CastReceipt immediately", () => {});
  it.todo("handler runs to completion after cast returns", () => {});
  it.todo("receipt contains actorType, entityId, operation, primaryKey", () => {});
  it.todo("requires MessageStorage in context — fails loudly without it", () => {});
  it.todo("auto-generates primaryKey when payload has no PrimaryKey implementation", () => {});
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
