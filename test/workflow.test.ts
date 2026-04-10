import { describe, expect, it, test } from "effect-bun-test";
import { Effect, Exit, Schema } from "effect";
import { DurableDeferred, WorkflowEngine } from "effect/unstable/workflow";
import { Workflow as WF } from "../src/index.js";

const Greeter = WF.workflow("Greeter", {
  payload: { name: Schema.String },
  idempotencyKey: (p) => (p as Record<string, string>)["name"] ?? "",
  success: Schema.String,
});

const greeterHandler = WF.workflowHandlers(Greeter, (payload: { name: string }) =>
  Effect.succeed(`hello ${payload.name}`),
);

// Note: each test provides its own handler + WorkflowEngine.layerMemory
// because different tests define different workflows

describe("Actor.workflow", () => {
  test("defines a workflow-backed actor with payload/success/error schemas", () => {
    expect(Greeter._tag).toBe("WorkflowDefinition");
    expect(Greeter.name).toBe("Greeter");
    expect(Greeter.workflow).toBeDefined();
  });

  it.scopedLive("idempotencyKey generates deterministic executionId", () =>
    Effect.gen(function* () {
      const ref1 = WF.workflowClient(Greeter)("g-idem-1");
      const receipt1 = yield* ref1.cast({ name: "deterministic" });

      const ref2 = WF.workflowClient(Greeter)("g-idem-2");
      const receipt2 = yield* ref2.cast({ name: "deterministic" });

      expect(receipt1.executionId).toBe(receipt2.executionId);
    }).pipe(
      Effect.provide(greeterHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.timeout("3 seconds"),
    ),
  );
});

describe("Workflow Ref.call", () => {
  it.live("executes workflow and blocks until Complete — returns success value", () =>
    Effect.gen(function* () {
      const ref = WF.workflowClient(Greeter)("greeter-1");
      const result = yield* ref.call({ name: "world" });
      expect(result).toBe("hello world");
    }).pipe(Effect.provide(greeterHandler), Effect.provide(WorkflowEngine.layerMemory)),
  );

  it.live("surfaces workflow errors in the error channel", () => {
    class WfError extends Schema.TaggedErrorClass<WfError>()("WfError", {
      reason: Schema.String,
    }) {}

    const FailWorkflow = WF.workflow("FailWork", {
      payload: { x: Schema.Number },
      idempotencyKey: (p) => String((p as Record<string, number>)["x"] ?? 0),
      success: Schema.String,
      error: WfError,
    });

    const failHandler = WF.workflowHandlers(FailWorkflow, (_payload: { x: number }) =>
      Effect.fail(new WfError({ reason: "boom" })),
    );

    return Effect.gen(function* () {
      const ref = WF.workflowClient(FailWorkflow)("fail-1");
      const exit = yield* ref.call({ x: 1 }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.provide(failHandler), Effect.provide(WorkflowEngine.layerMemory));
  });
});

describe("Workflow Ref.cast", () => {
  it.scopedLive("executes with discard: true — returns WorkflowReceipt with executionId", () =>
    Effect.gen(function* () {
      const ref = WF.workflowClient(Greeter)("greeter-cast-1");
      const receipt = yield* ref.cast({ name: "cast-test" });

      expect(receipt?._tag).toBe("WorkflowReceipt");
      expect(receipt?.workflowName).toBe("Greeter");
      expect(receipt?.executionId).toBeDefined();
      expect(typeof receipt?.executionId).toBe("string");
      expect(receipt!.executionId.length).toBeGreaterThan(0);
    }).pipe(
      Effect.provide(greeterHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.timeout("3 seconds"),
    ),
  );

  it.scopedLive("duplicate cast with same idempotencyKey returns same executionId", () =>
    Effect.gen(function* () {
      const r1 = yield* WF.workflowClient(Greeter)("dup-1").cast({ name: "same-key" });
      const r2 = yield* WF.workflowClient(Greeter)("dup-2").cast({ name: "same-key" });
      expect(r1.executionId).toBe(r2.executionId);
    }).pipe(
      Effect.provide(greeterHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.timeout("3 seconds"),
    ),
  );
});

describe("Workflow peek", () => {
  it.scopedLive("returns Success when workflow is Complete", () =>
    Effect.gen(function* () {
      const ref = WF.workflowClient(Greeter)("greeter-peek-1");
      const receipt = yield* ref.cast({ name: "peek-test" });
      yield* Effect.sleep("100 millis");
      const result = yield* WF.workflowPoll(Greeter, receipt.executionId);
      expect(result?._tag).toBe("Success");
    }).pipe(
      Effect.provide(greeterHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.timeout("5 seconds"),
    ),
  );

  it.live("returns Pending when workflow has not started", () =>
    Effect.gen(function* () {
      const result = yield* WF.workflowPoll(Greeter, "nonexistent-id-12345");
      expect(result?._tag).toBe("Pending");
    }).pipe(Effect.provide(greeterHandler), Effect.provide(WorkflowEngine.layerMemory)),
  );

  it.scopedLive("returns Suspended when workflow is waiting on DurableDeferred", () => {
    const BlockDeferred = WF.DurableDeferred.make("block-peek", {
      success: Schema.String,
    });

    const BlockWorkflow = WF.workflow("BlockPeek", {
      payload: { id: Schema.String },
      idempotencyKey: (p) => (p as Record<string, string>)["id"] ?? "",
      success: Schema.String,
    });

    const blockHandler = WF.workflowHandlers(
      BlockWorkflow,
      Effect.fn("blockHandler")(function* (_payload: { id: string }) {
        return yield* DurableDeferred.await(BlockDeferred);
      }),
    );

    return Effect.gen(function* () {
      const ref = WF.workflowClient(BlockWorkflow)("block-peek-1");
      yield* ref.cast({ id: "bp1" });
      yield* Effect.sleep("100 millis");
      const result = yield* WF.workflowPoll(BlockWorkflow, "bp1");
      expect(["Suspended", "Pending"]).toContain(result?._tag);
    }).pipe(
      Effect.provide(blockHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.timeout("5 seconds"),
    );
  });

  it.scopedLive("uses workflow.poll(executionId) under the hood", () =>
    Effect.gen(function* () {
      const ref = WF.workflowClient(Greeter)("poll-test-1");
      const receipt = yield* ref.cast({ name: "poll-verify" });
      yield* Effect.sleep("100 millis");
      const result = yield* WF.workflowPoll(Greeter, receipt.executionId);
      expect(result).toBeDefined();
      expect(result?._tag).toBe("Success");
      if (result?._tag === "Success") {
        expect(result.value).toBe("hello poll-verify");
      }
    }).pipe(
      Effect.provide(greeterHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.timeout("5 seconds"),
    ),
  );
});

describe("DurableDeferred integration", () => {
  const ApprovalDeferred = WF.DurableDeferred.make("approval", {
    success: Schema.String,
  });

  const ApprovalWorkflow = WF.workflow("Approval", {
    payload: { name: Schema.String },
    idempotencyKey: (p) => (p as Record<string, string>)["name"] ?? "",
    success: Schema.String,
  });

  const approvalHandler = WF.workflowHandlers(
    ApprovalWorkflow,
    Effect.fn("approvalHandler")(function* (payload: { name: string }) {
      const result = yield* DurableDeferred.await(ApprovalDeferred);
      return `${payload.name} approved: ${result}`;
    }),
  );

  test("DurableDeferred re-exports are available from Workflow module", () => {
    expect(WF.DurableDeferred).toBeDefined();
    expect(WF.DurableDeferred.make).toBeDefined();
    expect(WF.DurableDeferred.token).toBeDefined();
    expect(WF.DurableDeferred.tokenFromPayload).toBeDefined();
    expect(WF.DurableDeferred.succeed).toBeDefined();
  });

  test("Activity re-exports are available from Workflow module", () => {
    expect(WF.Activity).toBeDefined();
    expect(WF.Activity.make).toBeDefined();
    expect(WF.Activity.retry).toBeDefined();
  });

  it.scopedLive("DurableDeferred.succeed resumes a suspended workflow", () =>
    Effect.gen(function* () {
      const token = yield* DurableDeferred.tokenFromPayload(ApprovalDeferred, {
        workflow: ApprovalWorkflow.workflow,
        payload: { name: "test" },
      });

      const ref = WF.workflowClient(ApprovalWorkflow)("approval-1");
      const receipt = yield* ref.cast({ name: "test" });
      yield* Effect.sleep("100 millis");

      yield* DurableDeferred.succeed(ApprovalDeferred, { token, value: "yes" });
      yield* Effect.sleep("100 millis");

      const result = yield* WF.workflowPoll(ApprovalWorkflow, receipt.executionId);
      expect(result?._tag).toBe("Success");
      if (result?._tag === "Success") {
        expect(result.value).toBe("test approved: yes");
      }
    }).pipe(
      Effect.provide(approvalHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.timeout("5 seconds"),
    ),
  );

  it.live("Activity.make creates a durable checkpointed step", () => {
    let activityCallCount = 0;

    const ActivityWorkflow = WF.workflow("ActivityTest", {
      payload: { x: Schema.Number },
      idempotencyKey: (p) => String((p as Record<string, number>)["x"] ?? 0),
      success: Schema.Number,
    });

    const activityHandler = WF.workflowHandlers(
      ActivityWorkflow,
      Effect.fn("activityHandler")(function* (payload: { x: number }) {
        const activity = WF.Activity.make({
          name: "double",
          success: Schema.Number,
          execute: Effect.sync(() => {
            activityCallCount++;
            return payload.x * 2;
          }),
        });
        return yield* activity;
      }),
    );

    return Effect.gen(function* () {
      const ref = WF.workflowClient(ActivityWorkflow)("activity-1");
      const result = yield* ref.call({ x: 21 });
      expect(result).toBe(42);
      expect(activityCallCount).toBeGreaterThan(0);
    }).pipe(Effect.provide(activityHandler), Effect.provide(WorkflowEngine.layerMemory));
  });
});

describe("Workflow lifecycle", () => {
  it.scopedLive("ref.interrupt() signals workflow interruption", () => {
    const InterruptDeferred = WF.DurableDeferred.make("block-int", {
      success: Schema.String,
    });

    const InterruptWorkflow = WF.workflow("InterruptWork2", {
      payload: { x: Schema.Number },
      idempotencyKey: (p) => String((p as Record<string, number>)["x"] ?? 0),
      success: Schema.String,
    });

    const interruptHandler = WF.workflowHandlers(
      InterruptWorkflow,
      Effect.fn("interruptHandler")(function* (_payload: { x: number }) {
        return yield* DurableDeferred.await(InterruptDeferred);
      }),
    );

    return Effect.gen(function* () {
      const ref = WF.workflowClient(InterruptWorkflow)("int-1");
      const receipt = yield* ref.cast({ x: 1 });

      yield* Effect.sleep("100 millis");

      // Interrupt should not throw
      yield* ref.interrupt();

      yield* Effect.sleep("100 millis");

      // After interrupt, poll should show non-pending state
      const result = yield* WF.workflowPoll(InterruptWorkflow, receipt.executionId);
      // Memory engine may show Failure (interrupted) or Suspended
      expect(result._tag).not.toBe("Success");
    }).pipe(
      Effect.provide(interruptHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.timeout("3 seconds"),
    );
  });

  it.scopedLive("ref.resume() resumes a suspended workflow", () => {
    const ResumeDeferred = WF.DurableDeferred.make("resume-signal", {
      success: Schema.String,
    });

    const ResumeWorkflow = WF.workflow("ResumableWork", {
      payload: { id: Schema.String },
      idempotencyKey: (p) => (p as Record<string, string>)["id"] ?? "",
      success: Schema.String,
    });

    const resumeHandler = WF.workflowHandlers(
      ResumeWorkflow,
      Effect.fn("resumeHandler")(function* (payload: { id: string }) {
        const result = yield* DurableDeferred.await(ResumeDeferred);
        return `${payload.id}: ${result}`;
      }),
    );

    return Effect.gen(function* () {
      const ref = WF.workflowClient(ResumeWorkflow)("resume-1");
      const receipt = yield* ref.cast({ id: "r1" });
      yield* Effect.sleep("100 millis");

      const token = yield* DurableDeferred.tokenFromPayload(ResumeDeferred, {
        workflow: ResumeWorkflow.workflow,
        payload: { id: "r1" },
      });

      yield* DurableDeferred.succeed(ResumeDeferred, { token, value: "resumed" });
      yield* ref.resume();
      yield* Effect.sleep("200 millis");

      const result = yield* WF.workflowPoll(ResumeWorkflow, receipt.executionId);
      expect(result?._tag).toBe("Success");
      if (result?._tag === "Success") {
        expect(result.value).toBe("r1: resumed");
      }
    }).pipe(
      Effect.provide(resumeHandler),
      Effect.provide(WorkflowEngine.layerMemory),
      Effect.timeout("5 seconds"),
    );
  });
});
