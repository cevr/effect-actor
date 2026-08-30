import { Effect, ManagedRuntime, Schema } from "effect";
import { Actor } from "../src/index.js";

const WorkflowMessaging = Actor.fromWorkflow("WorkflowMessagingBenchmark", {
  payload: { id: Schema.String, value: Schema.Number },
  success: Schema.Number,
  id: (payload: { readonly id: string }) => payload.id,
});

const WorkflowMessagingTest = Actor.toTestLayer(WorkflowMessaging, (payload) =>
  Effect.succeed(payload.value + 1),
);

const runtime = ManagedRuntime.make(WorkflowMessagingTest);

const median = (samples: Array<number>): number => {
  samples.sort((left, right) => left - right);
  return samples[2];
};

const measureSync = (iterations: number, operation: (index: number) => unknown): number => {
  for (let index = 0; index < iterations; index++) operation(index);
  const samples: Array<number> = [];
  for (let sample = 0; sample < 5; sample++) {
    const startedAt = Bun.nanoseconds();
    for (let index = 0; index < iterations; index++) operation(index);
    samples.push((Bun.nanoseconds() - startedAt) / iterations);
  }
  return median(samples);
};

const measureEffect = <A, E, R>(
  iterations: number,
  operation: (index: number) => Effect.Effect<A, E, R>,
): Promise<number> =>
  runtime.runPromise(
    Effect.gen(function* () {
      for (let index = 0; index < iterations; index++) yield* operation(index);
      const samples: Array<number> = [];
      for (let sample = 0; sample < 5; sample++) {
        const startedAt = Bun.nanoseconds();
        for (let index = 0; index < iterations; index++) yield* operation(index);
        samples.push((Bun.nanoseconds() - startedAt) / iterations);
      }
      return median(samples);
    }),
  );

const payload = { id: "same-workflow", value: 1 };
const executionId = await runtime.runPromise(WorkflowMessaging.executionId(payload));
const actorRef = await runtime.runPromise(
  Effect.gen(function* () {
    const factory = yield* WorkflowMessaging.Context;
    return yield* factory(executionId);
  }),
);
const operationValue = WorkflowMessaging.make(payload);
let executeId = 0;
let sendId = 0;
const rows: Array<readonly [string, number]> = [
  ["make", measureSync(1_000_000, () => WorkflowMessaging.make(payload))],
  ["executionId effect", measureSync(100_000, () => WorkflowMessaging.executionId(payload))],
  ["executionId run", await measureEffect(10_000, () => WorkflowMessaging.executionId(payload))],
  ["execute, same id", await measureEffect(1_000, () => WorkflowMessaging.execute(payload))],
  [
    "actor ref factory, same id",
    await measureEffect(10_000, () =>
      Effect.gen(function* () {
        const factory = yield* WorkflowMessaging.Context;
        return yield* factory(executionId);
      }),
    ),
  ],
  [
    "actor ref execute, prebuilt operation",
    await measureEffect(1_000, () => actorRef.execute(operationValue)),
  ],
  [
    "execute, unique ids",
    await measureEffect(1_000, () => {
      executeId++;
      return WorkflowMessaging.execute({ id: `execute-${executeId}`, value: executeId });
    }),
  ],
  ["send, same id", await measureEffect(1_000, () => WorkflowMessaging.send(payload))],
  [
    "send, unique ids",
    await measureEffect(1_000, () => {
      sendId++;
      return WorkflowMessaging.send({ id: `send-${sendId}`, value: sendId });
    }),
  ],
];

console.log("workflow operation\tns/op\tops/s");
for (const [name, nanoseconds] of rows) {
  console.log(`${name}\t${nanoseconds.toFixed(0)}\t${(1_000_000_000 / nanoseconds).toFixed(0)}`);
}

await runtime.dispose();
