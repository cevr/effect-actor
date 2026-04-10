import { describe, expect, it, test } from "effect-bun-test";
import type { Layer } from "effect";
import { Context, Effect, Schema } from "effect";
import { ClusterSchema, ShardingConfig } from "effect/unstable/cluster";
import { Actor, Testing } from "../src/index.js";

const TestShardingConfig = ShardingConfig.layer({
  shardsPerGroup: 300,
  entityMailboxCapacity: 10,
  entityTerminationTimeout: 0,
});

const effectTest = it.scopedLive.layer(TestShardingConfig);

const Counter = Actor.make("Counter", {
  Increment: {
    payload: { amount: Schema.Number },
    success: Schema.Number,
  },
  GetCount: {
    success: Schema.Number,
  },
});

// Use entity.toLayer directly — it infers handler types from the Rpcs
const handlerLayer = Counter.entity.toLayer({
  Increment: (request) => Effect.succeed(request.payload.amount + 1),
  GetCount: () => Effect.succeed(42),
}) as unknown as Layer.Layer<never>;

describe("Actor.make", () => {
  test("defines a multi-operation actor with typed payload/success/error schemas", () => {
    expect(Counter.name).toBe("Counter");
    expect(Counter._tag).toBe("ActorDefinition");
    expect(Counter.entity).toBeDefined();
    expect(Counter.operations).toBeDefined();
    expect(Object.keys(Counter.operations)).toEqual(["Increment", "GetCount"]);
  });

  test("compiles operations into Entity under the hood", () => {
    expect(Counter.entity).toBeDefined();
  });

  test("attaches persisted annotation when persisted: true", () => {
    const Persisted = Actor.make("Persisted", {
      Save: {
        payload: { data: Schema.String },
        success: Schema.Void,
        persisted: true,
      },
    });
    const rpc = Persisted.entity.protocol.requests.get("Save")!;
    const val = Context.get(rpc.annotations, ClusterSchema.Persisted);
    expect(val).toBe(true);
  });

  test("attaches primaryKey extractor from definition", () => {
    const WithPK = Actor.make("WithPK", {
      Op: {
        payload: { id: Schema.String },
        success: Schema.Void,
        persisted: true,
        primaryKey: (p: { id: string }) => p.id,
      },
    });
    expect(WithPK.operations["Op"]!.primaryKey).toBeDefined();
    const pk = WithPK.operations["Op"]!.primaryKey!({ id: "abc" } as never);
    expect(pk).toBe("abc");
  });

  test("operations without explicit persisted: true use cluster default", () => {
    const rpc = Counter.entity.protocol.requests.get("Increment")!;
    const result = Context.getOption(rpc.annotations, ClusterSchema.Persisted);
    expect(Counter.operations["Increment"]!.persisted).toBeUndefined();
    expect(result._tag).toBe("Some");
  });
});

const Ping = Actor.single("Ping", {
  payload: { message: Schema.String },
  success: Schema.String,
});

const pingHandlers = Ping.entity.toLayer({
  Ping: (request) => Effect.succeed(`pong: ${request.payload.message}`),
}) as unknown as Layer.Layer<never>;

describe("Actor.single", () => {
  effectTest("defines a single-operation actor — no operation namespace on ref", () =>
    Effect.gen(function* () {
      expect(Ping.name).toBe("Ping");
      expect(Ping._tag).toBe("SingleActorDefinition");
      expect(Ping.operationTag).toBe("Ping");

      const makeRef = yield* Testing.testSingleClient(Ping, pingHandlers);
      const ref = yield* makeRef("p-1");
      const result = yield* ref.call({ message: "hello" });
      expect(result).toBe("pong: hello");
    }),
  );

  test("supports persisted + primaryKey options", () => {
    const PingSave = Actor.single("PingSave", {
      payload: { msg: Schema.String },
      success: Schema.String,
      persisted: true,
      primaryKey: (p: { msg: string }) => p.msg,
    });
    expect(PingSave.operation.persisted).toBe(true);
    expect(PingSave.operation.primaryKey).toBeDefined();
    const rpc = PingSave.entity.protocol.requests.get("PingSave")!;
    const val = Context.get(rpc.annotations, ClusterSchema.Persisted);
    expect(val).toBe(true);
  });
});

describe("Actor.client", () => {
  effectTest("returns a function (entityId) => Ref with typed operations", () =>
    Effect.gen(function* () {
      const makeRef = yield* Testing.testClient(Counter, handlerLayer);
      const ref = yield* makeRef("counter-1");
      expect(ref["Increment"]).toBeDefined();
      expect(ref["Increment"]?.call).toBeDefined();
      expect(ref["GetCount"]).toBeDefined();
      expect(ref["GetCount"]?.call).toBeDefined();
    }),
  );
});
