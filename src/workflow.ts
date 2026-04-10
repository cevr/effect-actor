import { Effect } from "effect";
import type { Layer } from "effect";
import { Workflow } from "effect/unstable/workflow";

export interface WorkflowDefinition<Name extends string = string> {
  readonly _tag: "WorkflowDefinition";
  readonly name: Name;
  readonly workflow: Workflow.Any;
}

export interface WorkflowReceipt<Type extends string = string> {
  readonly _tag: "WorkflowReceipt";
  readonly workflowName: Type;
  readonly executionId: string;
}

export const makeWorkflowReceipt = <Type extends string>(
  workflowName: Type,
  executionId: string,
): WorkflowReceipt<Type> => ({
  _tag: "WorkflowReceipt",
  workflowName,
  executionId,
});

export const workflow = <const Name extends string>(
  name: Name,
  options: {
    readonly payload: Record<string, unknown>;
    readonly idempotencyKey: (payload: Record<string, unknown>) => string;
    readonly success?: unknown;
    readonly error?: unknown;
  },
): WorkflowDefinition<Name> => {
  const wfOptions: Record<string, unknown> = {
    name,
    payload: options.payload,
    idempotencyKey: options.idempotencyKey,
  };
  if (options.success) wfOptions["success"] = options.success;
  if (options.error) wfOptions["error"] = options.error;

  const wf = (Workflow.make as Function)(wfOptions) as Workflow.Any;

  return {
    _tag: "WorkflowDefinition",
    name,
    workflow: wf,
  };
};

export type WorkflowRef<Name extends string = string> = {
  readonly call: (payload: unknown) => Effect.Effect<unknown, unknown>;
  readonly cast: (payload: unknown) => Effect.Effect<WorkflowReceipt<Name>, unknown>;
  readonly interrupt: () => Effect.Effect<void>;
  readonly resume: () => Effect.Effect<void>;
};

export const workflowClient = <Name extends string>(
  def: WorkflowDefinition<Name>,
): ((executionId: string) => WorkflowRef<Name>) => {
  const wf = def.workflow as Workflow.Any & {
    execute: Function;
    interrupt: Function;
    resume: Function;
  };

  return (_executionId: string): WorkflowRef<Name> => ({
    call: (payload: unknown) => wf.execute(payload) as Effect.Effect<unknown, unknown>,
    cast: (payload: unknown) =>
      Effect.map(
        wf.execute(payload, { discard: true }) as Effect.Effect<string, unknown>,
        (execId) => makeWorkflowReceipt(def.name, execId),
      ),
    interrupt: () => wf.interrupt(_executionId) as Effect.Effect<void>,
    resume: () => wf.resume(_executionId) as Effect.Effect<void>,
  });
};

export const workflowHandlers = <Name extends string>(
  def: WorkflowDefinition<Name>,
  handler: Function,
): Layer.Layer<never, never, never> => {
  const wf = def.workflow as Workflow.Any & { toLayer: Function };
  return wf.toLayer(handler) as Layer.Layer<never, never, never>;
};
