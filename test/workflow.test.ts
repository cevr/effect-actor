import { describe, expect, it } from "bun:test";
import { Effect, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow";
import { Workflow as WF } from "../src/index.js";

const Greeter = WF.workflow("Greeter", {
  payload: { name: Schema.String },
  idempotencyKey: (p) => (p as Record<string, string>)["name"] ?? "",
  success: Schema.String,
});

const greeterHandler = WF.workflowHandlers(Greeter, (payload: { name: string }) =>
  Effect.succeed(`hello ${payload.name}`),
);

describe("Actor.workflow", () => {
  it("defines a workflow-backed actor with payload/success/error schemas", () => {
    expect(Greeter._tag).toBe("WorkflowDefinition");
    expect(Greeter.name).toBe("Greeter");
    expect(Greeter.workflow).toBeDefined();
  });

  it.todo("idempotencyKey generates deterministic executionId", () => {});
});

describe("Workflow Ref.call", () => {
  it("executes workflow and blocks until Complete — returns success value", async () => {
    const result = await Effect.gen(function* () {
      const ref = WF.workflowClient(Greeter)("greeter-1");
      return yield* ref.call({ name: "world" });
    }).pipe(
      Effect.provide(greeterHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.runPromise,
    );

    expect(result).toBe("hello world");
  });

  it.todo("surfaces workflow errors in the error channel", () => {});
  it.todo("retries through Suspended states until Complete", () => {});
});

describe("Workflow Ref.cast", () => {
  it("executes with discard: true — returns WorkflowReceipt with executionId", async () => {
    const receipt = await Effect.gen(function* () {
      const ref = WF.workflowClient(Greeter)("greeter-cast-1");
      return yield* ref.cast({ name: "cast-test" });
    }).pipe(
      Effect.provide(greeterHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.scoped,
      Effect.timeout("3 seconds"),
      Effect.runPromise,
    );

    expect(receipt?._tag).toBe("WorkflowReceipt");
    expect(receipt?.workflowName).toBe("Greeter");
    expect(receipt?.executionId).toBeDefined();
    expect(typeof receipt?.executionId).toBe("string");
    expect(receipt!.executionId.length).toBeGreaterThan(0);
  });

  it.todo("duplicate cast with same idempotencyKey is idempotent", () => {});
});

describe("Workflow peek", () => {
  it("returns Success when workflow is Complete", async () => {
    const result = await Effect.gen(function* () {
      const ref = WF.workflowClient(Greeter)("greeter-peek-1");
      const receipt = yield* ref.cast({ name: "peek-test" });

      // Wait for workflow to complete
      yield* Effect.sleep("100 millis");

      return yield* WF.workflowPoll(Greeter, receipt.executionId);
    }).pipe(
      Effect.provide(greeterHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.scoped,
      Effect.timeout("5 seconds"),
      Effect.runPromise,
    );

    expect(result?._tag).toBe("Success");
  });

  it.todo("returns Pending when workflow has not started", () => {});
  it.todo("returns Pending when workflow is Suspended", () => {});
  it.todo("uses workflow.poll(executionId) under the hood", () => {});
});

describe("DurableDeferred integration", () => {
  it.todo("ref.token(deferred) returns a Token for external completion", () => {});
  it.todo("DurableDeferred.succeed resumes a suspended workflow", () => {});
  it.todo("token can be generated before workflow starts via tokenFromPayload", () => {});
});

describe("Workflow lifecycle", () => {
  it.todo("ref.interrupt() signals workflow interruption", () => {});
  it.todo("ref.resume() resumes a suspended workflow", () => {});
  it.todo("activities checkpoint — replay skips completed steps", () => {});
});
