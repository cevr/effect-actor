import { describe, expect, it } from "bun:test";
import { Effect, Schema } from "effect";
import { ShardingConfig } from "effect/unstable/cluster";
import type { ActorDefinition } from "../src/actor.js";
import { Actor, Handlers, Testing } from "../src/index.js";

const TestShardingConfig = ShardingConfig.layer({
  shardsPerGroup: 300,
  entityMailboxCapacity: 10,
  entityTerminationTimeout: 0,
});

const Counter = Actor.make("Counter", {
  Increment: {
    payload: { amount: Schema.Number },
    success: Schema.Number,
  },
  GetCount: {
    success: Schema.Number,
  },
});

const handlerLayer = Handlers.handlers(Counter, {
  Increment: (request: any) => Effect.succeed(request.payload.amount + 1),
  GetCount: () => Effect.succeed(42),
});

describe("Actor.make", () => {
  it("defines a multi-operation actor with typed payload/success/error schemas", () => {
    expect(Counter.name).toBe("Counter");
    expect(Counter.entity).toBeDefined();
    expect(Counter.rpcs.size).toBe(2);
    expect(Counter.rpcs.has("Increment")).toBe(true);
    expect(Counter.rpcs.has("GetCount")).toBe(true);
  });

  it("compiles operations into Entity under the hood", () => {
    expect(Counter.entity).toBeDefined();
  });

  it.todo("attaches persisted annotation when persisted: true", () => {});
  it.todo("attaches primaryKey extractor from definition", () => {});
  it.todo("attaches deliverAt schedule from definition", () => {});
});

const Ping = Actor.single("Ping", {
  payload: { message: Schema.String },
  success: Schema.String,
});

const pingHandlers = Handlers.handlers({ entity: Ping.entity } as unknown as ActorDefinition, {
  Ping: (request: { payload: { message: string } }) =>
    Effect.succeed(`pong: ${request.payload.message}`),
});

describe("Actor.single", () => {
  it("defines a single-operation actor — no operation namespace on ref", async () => {
    expect(Ping.name).toBe("Ping");
    expect(Ping._tag).toBe("SingleActorDefinition");
    expect(Ping.operationTag).toBe("Ping");

    const result = await Effect.gen(function* () {
      const makeRef = yield* Testing.testSingleClient(Ping, pingHandlers);
      const ref = yield* makeRef("p-1");
      return yield* ref.call({ message: "hello" });
    }).pipe(Effect.scoped, Effect.provide(TestShardingConfig), Effect.runPromise);

    expect(result).toBe("pong: hello");
  });

  it.todo("supports same options as multi-operation (persisted, primaryKey, deliverAt)", () => {});
});

describe("Actor.client", () => {
  it("returns a function (entityId) => Ref with typed operations", async () => {
    const program = Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(Counter, handlerLayer);
      const ref = yield* makeRef("counter-1");
      expect(ref.Increment).toBeDefined();
      expect(ref.Increment.call).toBeDefined();
      expect(ref.GetCount).toBeDefined();
      expect(ref.GetCount.call).toBeDefined();
    }).pipe(Effect.scoped, Effect.provide(TestShardingConfig));

    await Effect.runPromise(program);
  });
});
