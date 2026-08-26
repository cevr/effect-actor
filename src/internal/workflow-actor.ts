/* oxlint-disable effect/noAs, effect/noChainedTypeAssertions, effect/noKnownValueWidening, effect/noUnknownParameters, effect/noUnsafeDictionaryType -- This module is the single erased boundary between upstream Workflow runtime types and Encore's schema-derived actor interface. */
/* eslint-disable typescript-eslint/no-explicit-any -- upstream Workflow and Rpc dispatch are erased at this compiler boundary */
import type { PersistenceError } from "effect/unstable/cluster/ClusterError";
import { Workflow as UpstreamWorkflow } from "effect/unstable/workflow";
import {
  WorkflowEngine,
  layerMemory as workflowEngineLayerMemory,
} from "effect/unstable/workflow/WorkflowEngine";
import type { Duration, Schedule, Schema } from "effect";
import { Cause, Context, Effect, Layer, Option, Predicate, Stream } from "effect";
import { ActorDefect } from "../actor-defect.js";
import { Client } from "../client.js";
import { Pending, Suspended, makeExecId, mapExitToWorkflowPeekResult } from "../receipt.js";
import type { ExecId, PeekResult } from "../receipt.js";
import {
  decideCompensation,
  decidePendingCompensation,
  makeSignal,
  makeWorkflowExecution,
  pendingCompensation,
} from "../step.js";
import type { CompensationDecision, SignalDefs, WorkflowSignal } from "../step.js";
import { waitFor, watch } from "./execution-observation.js";
import type {
  ActorClientFactory,
  ActorClientService,
  ActorRef,
  OperationBrand,
  WorkflowActor,
  WorkflowDef,
} from "../actor.js";
import type { EntityIdReturn } from "./invocation-compiler.js";

const WORKFLOW_RESERVED_KEYS = new Set<string>([
  "_tag",
  "_meta",
  "$is",
  "Context",
  "compensation",
  "name",
  "type",
  "of",
  "execute",
  "send",
  "peek",
  "watch",
  "waitFor",
  "rerun",
  "make",
  "interrupt",
  "resume",
  "signal",
  "executionId",
  "pipe",
]);

type WorkflowPayloadType<Payload extends Schema.Struct.Fields> = {
  readonly [K in keyof Payload]: Schema.Schema.Type<
    Payload[K] extends Schema.Top ? Payload[K] : never
  >;
};

type WorkflowRunDefs<
  Payload extends Schema.Struct.Fields,
  Success extends Schema.Top,
  Error extends Schema.Top,
> = {
  readonly Run: {
    readonly payload: Schema.Struct<Payload>;
    readonly success: Success;
    readonly error: Error;
    readonly id: (payload: never) => EntityIdReturn;
  };
};

type WorkflowReadServices<Success extends Schema.Top, Error extends Schema.Top> =
  | WorkflowEngine
  | Success["DecodingServices"]
  | Error["DecodingServices"];

type WorkflowPeekResult<Success extends Schema.Top, Error extends Schema.Top> = PeekResult<
  Success["Type"],
  Error["Type"]
>;

export const compileWorkflowActor = <
  const Name extends string,
  const Payload extends Schema.Struct.Fields,
  Success extends Schema.Top = typeof Schema.Void,
  Error extends Schema.Top = typeof Schema.Never,
  const Signals extends SignalDefs = {},
>(
  name: Name,
  def: WorkflowDef<Payload, Success, Error, Signals>,
): WorkflowActor<Name, Payload, Success, Error, Signals> => {
  const workflowOptions: Record<string, unknown> = {
    payload: def.payload,
    idempotencyKey: def.id,
  };
  if (def.success) workflowOptions["success"] = def.success;
  if (def.error) workflowOptions["error"] = def.error;
  if (def.suspendedRetrySchedule)
    workflowOptions["suspendedRetrySchedule"] = def.suspendedRetrySchedule;

  let workflow = (UpstreamWorkflow.make as Function)(
    name,
    workflowOptions,
  ) as UpstreamWorkflow.Workflow<Name, Schema.Struct<Payload>, Success, Error>;
  const captureDefects = Option.fromNullishOr(def.captureDefects);
  if (Option.isSome(captureDefects))
    workflow = workflow.annotate(UpstreamWorkflow.CaptureDefects, captureDefects.value);
  const suspendOnFailure = Option.fromNullishOr(def.suspendOnFailure);
  if (Option.isSome(suspendOnFailure))
    workflow = workflow.annotate(UpstreamWorkflow.SuspendOnFailure, suspendOnFailure.value);

  type WfDefs = WorkflowRunDefs<Payload, Success, Error>;

  class WorkflowClientContext extends Context.Service<
    WorkflowClientContext,
    ActorClientFactory<Name, WfDefs>
  >()(`effect-encore/${name}/Client`) {}

  const contextTag = WorkflowClientContext as unknown as Context.Service<
    ActorClientService<Name, WfDefs>,
    ActorClientFactory<Name, WfDefs>
  >;

  const make = (payload: WorkflowPayloadType<Payload>) =>
    ({ _tag: "Run", ...payload }) as { readonly _tag: "Run" } & WorkflowPayloadType<Payload> &
      OperationBrand<Name, "Run", Schema.Schema.Type<Success>, Schema.Schema.Type<Error>>;

  const signals: Record<string, WorkflowSignal<any, any, any>> = {};
  for (const [signalName, signalDef] of Object.entries(def.signals ?? {})) {
    if (WORKFLOW_RESERVED_KEYS.has(signalName)) {
      // oxlint-disable-next-line effect/noThrowStatement -- The synchronous compiler must reject invalid definitions at module initialization.
      throw new ActorDefect({
        message: `effect-encore: signal "${signalName}" collides with reserved property on workflow "${name}". Reserved: ${[...WORKFLOW_RESERVED_KEYS].join(", ")}`,
      });
    }
    signals[signalName] = makeSignal(workflow, signalName, {
      success: signalDef.success,
      error: signalDef.error,
    });
  }

  const executionIdFor = (payload: WorkflowPayloadType<Payload>): Effect.Effect<string> =>
    workflow.executionId(payload as never);

  type RawPeek = WorkflowPeekResult<Success, Error>;

  const peekAt = (
    executionId: string,
  ): Effect.Effect<RawPeek, never, WorkflowReadServices<Success, Error>> =>
    Effect.map(workflow.poll(executionId), (result) =>
      Option.match(result, {
        onNone: () => Pending,
        onSome: (value) => {
          if (value._tag === "Suspended") return Suspended;
          return mapExitToWorkflowPeekResult(value.exit);
        },
      }),
    );

  const watchAt = (executionId: string, options?: { readonly interval?: Duration.Input }) =>
    watch(peekAt(executionId), options);

  const waitForAt = (
    executionId: string,
    options?: {
      readonly filter?: (result: RawPeek) => boolean;
      readonly schedule?: Schedule.Schedule<any, unknown>;
    },
  ) => waitFor(peekAt(executionId), options);

  const compensation = {
    pending: (executionId: string) => pendingCompensation(workflow, executionId),
    decide: (
      executionId: string,
      stepId: string,
      attempt: number,
      decision: CompensationDecision,
    ) => decideCompensation(workflow, executionId, stepId, attempt, decision),
    decidePending: (executionId: string, decision: CompensationDecision) =>
      decidePendingCompensation(workflow, executionId, decision),
    retry: (executionId: string, stepId: string, attempt: number) =>
      decideCompensation(workflow, executionId, stepId, attempt, "Retry"),
    stop: (executionId: string, stepId: string, attempt: number) =>
      decideCompensation(workflow, executionId, stepId, attempt, "Stop"),
  };

  const signal = <
    S extends Schema.Top = typeof Schema.Void,
    E extends Schema.Top = typeof Schema.Never,
  >(
    signalName: string,
    options?: { readonly success?: S; readonly error?: E },
  ): WorkflowSignal<Schema.Struct<Payload>, S, E> => makeSignal(workflow, signalName, options);

  const prune = (executionId: string) =>
    Client.use((client) => client.pruneWorkflow(workflow, executionId));

  const rerun = (
    payload: WorkflowPayloadType<Payload>,
  ): Effect.Effect<void, PersistenceError, Client | WorkflowEngine> =>
    Effect.gen(function* () {
      const executionId = yield* executionIdFor(payload);
      yield* workflow.interrupt(executionId);
      yield* prune(executionId);
    });

  const execute = (payload: WorkflowPayloadType<Payload>) =>
    Effect.gen(function* () {
      const factory = yield* contextTag;
      const executionId = yield* executionIdFor(payload);
      const ref = yield* factory(executionId);
      return yield* ref.execute(make(payload) as never);
    }) as unknown as Effect.Effect<
      Schema.Schema.Type<Success>,
      Schema.Schema.Type<Error>,
      ActorClientService<Name, WfDefs>
    >;

  const send = (payload: WorkflowPayloadType<Payload>) =>
    Effect.gen(function* () {
      const factory = yield* contextTag;
      const executionId = yield* executionIdFor(payload);
      const ref = yield* factory(executionId);
      return yield* ref.send(make(payload) as never);
    }) as unknown as Effect.Effect<
      ExecId<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>>,
      never,
      ActorClientService<Name, WfDefs>
    >;

  return {
    ...signals,
    _tag: "WorkflowActor",
    name,
    type: `Workflow/${name}`,
    _meta: { name, workflow },
    Context: contextTag,
    signal,
    execute,
    send,
    executionId: (payload: WorkflowPayloadType<Payload>) =>
      Effect.map(workflow.executionId(payload as never), makeExecId),
    peek: (payload: WorkflowPayloadType<Payload>) =>
      Effect.flatMap(executionIdFor(payload), peekAt),
    peekAt,
    watch: (
      payload: WorkflowPayloadType<Payload>,
      options?: { readonly interval?: Duration.Input },
    ) =>
      Stream.unwrap(
        Effect.map(executionIdFor(payload), (executionId) => watchAt(executionId, options)),
      ),
    watchAt,
    waitFor: (
      payload: WorkflowPayloadType<Payload>,
      options?: {
        readonly filter?: (result: RawPeek) => boolean;
        readonly schedule?: Schedule.Schedule<any, unknown>;
      },
    ) => Effect.flatMap(executionIdFor(payload), (executionId) => waitForAt(executionId, options)),
    waitForAt,
    rerun,
    prune,
    interrupt: (executionId: string) => workflow.interrupt(executionId),
    resume: (executionId: string) => workflow.resume(executionId),
    compensation,
    make,
    $is: (tag: "Run") => (value: unknown) =>
      Predicate.hasProperty(value, "_tag") && value["_tag"] === tag,
  } as unknown as WorkflowActor<Name, Payload, Success, Error, Signals>;
};

export const isWorkflowActor = <Value>(actor: Value): boolean =>
  Predicate.hasProperty(actor, "_tag") && actor["_tag"] === "WorkflowActor";

const buildWorkflowActorRef = (
  actor: WorkflowActor<any, any, any, any>,
  engine: WorkflowEngine["Service"],
): ActorRef<any, any> => {
  const workflow = actor._meta.workflow;
  return {
    execute: (operation: { readonly _tag: string; readonly [key: string]: unknown }) => {
      const { _tag: _, ...payload } = operation;
      return workflow.execute(payload as any).pipe(Effect.provideService(WorkflowEngine, engine));
    },
    send: (operation: { readonly _tag: string; readonly [key: string]: unknown }) => {
      const { _tag: _, ...payload } = operation;
      return Effect.map(
        workflow
          .execute(payload as any, { discard: true })
          .pipe(Effect.provideService(WorkflowEngine, engine)) as Effect.Effect<string>,
        makeExecId,
      );
    },
  } as ActorRef<any, any>;
};

const wrapWorkflowHandler = (actor: WorkflowActor<any, any, any, any>, handler: Function) => {
  const workflow = actor._meta.workflow;
  return (payload: any, executionId: string) => {
    const execution = makeWorkflowExecution(workflow, executionId);
    return Effect.catchCause(handler(payload, execution.step), (cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
      return execution.compensate(cause).pipe(Effect.andThen(Effect.failCause(cause)));
    });
  };
};

const layerPassthrough = <ROut, E, RIn>(
  layer: Layer.Layer<ROut, E, RIn>,
): Layer.Layer<ROut | RIn, E, RIn> =>
  Layer.merge(Layer.effectContext(Effect.context<RIn>()), layer);

export const workflowToLayer = (
  actor: WorkflowActor<any, any, any, any>,
  handler: Function,
): Layer.Layer<any, any, any> => {
  const handlerLayer = actor._meta.workflow.toLayer(wrapWorkflowHandler(actor, handler) as any);
  const clientLayer = Layer.effect(
    actor.Context,
    Effect.map(
      WorkflowEngine,
      (engine) => (_entityId: string) => Effect.succeed(buildWorkflowActorRef(actor, engine)),
    ),
  );
  return layerPassthrough(Layer.merge(handlerLayer, clientLayer));
};

export const workflowToTestLayer = (
  actor: WorkflowActor<any, any, any, any>,
  handler: Function,
): Layer.Layer<any, any, any> => {
  const handlerLayer = actor._meta.workflow.toLayer(wrapWorkflowHandler(actor, handler) as any);
  const clientLayer = Layer.effect(
    actor.Context,
    Effect.map(
      WorkflowEngine,
      (engine) => (_entityId: string) => Effect.succeed(buildWorkflowActorRef(actor, engine)),
    ),
  );
  return Layer.provideMerge(Layer.merge(handlerLayer, clientLayer), workflowEngineLayerMemory);
};
