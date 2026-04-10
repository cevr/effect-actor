import { Effect } from "effect";
import type { ActorDefinition, OperationDefinition, OperationDefinitions } from "./actor.js";
import { makeCastReceipt } from "./receipt.js";
import type { CastReceipt } from "./receipt.js";

export type Ref<Ops extends OperationDefinitions> = {
  readonly [K in keyof Ops]: {
    readonly call: Ops[K]["payload"] extends Record<string, unknown>
      ? (payload: {
          readonly [F in keyof Ops[K]["payload"]]: unknown;
        }) => Effect.Effect<unknown, unknown>
      : () => Effect.Effect<unknown, unknown>;
    readonly cast: Ops[K]["payload"] extends Record<string, unknown>
      ? (payload: {
          readonly [F in keyof Ops[K]["payload"]]: unknown;
        }) => Effect.Effect<CastReceipt, unknown>
      : () => Effect.Effect<CastReceipt, unknown>;
  };
};

export type SingleRef<Op extends OperationDefinition> = {
  readonly call: Op["payload"] extends Record<string, unknown>
    ? (payload: {
        readonly [F in keyof Op["payload"]]: unknown;
      }) => Effect.Effect<unknown, unknown>
    : () => Effect.Effect<unknown, unknown>;
  readonly cast: Op["payload"] extends Record<string, unknown>
    ? (payload: {
        readonly [F in keyof Op["payload"]]: unknown;
      }) => Effect.Effect<CastReceipt, unknown>
    : () => Effect.Effect<CastReceipt, unknown>;
};

const makeCallFn = (rpcClient: Record<string, Function>, tag: string, hasPayload: boolean) => {
  return (payload?: unknown) => {
    const fn = rpcClient[tag];
    return hasPayload ? fn?.(payload) : fn?.();
  };
};

const makeCastFn = (
  rpcClient: Record<string, Function>,
  tag: string,
  hasPayload: boolean,
  actorName: string,
  entityId: string,
  primaryKeyFn?: (payload: never) => string,
) => {
  return (payload?: unknown) => {
    const fn = rpcClient[tag];
    const discardCall = hasPayload ? fn?.(payload, { discard: true }) : fn?.({ discard: true });
    return Effect.map(discardCall ?? Effect.void, () => {
      const pk = primaryKeyFn ? primaryKeyFn(payload as never) : crypto.randomUUID();
      return makeCastReceipt({
        actorType: actorName,
        entityId,
        operation: tag,
        primaryKey: pk,
      });
    });
  };
};

export const buildRef = <Ops extends OperationDefinitions>(
  actorName: string,
  entityId: string,
  operations: Ops,
  rpcClient: Record<string, Function>,
): Ref<Ops> => {
  const ref = {} as Record<string, unknown>;
  for (const tag of Object.keys(operations)) {
    const op = operations[tag];
    const hasPayload = op?.payload !== undefined;
    ref[tag] = {
      call: makeCallFn(rpcClient, tag, hasPayload),
      cast: makeCastFn(rpcClient, tag, hasPayload, actorName, entityId, op?.primaryKey),
    };
  }
  return ref as Ref<Ops>;
};

export const buildSingleRef = <Op extends OperationDefinition>(
  actorName: string,
  entityId: string,
  operationTag: string,
  operation: Op,
  rpcClient: Record<string, Function>,
): SingleRef<Op> => {
  const hasPayload = operation["payload"] !== undefined;
  return {
    call: makeCallFn(rpcClient, operationTag, hasPayload) as SingleRef<Op>["call"],
    cast: makeCastFn(
      rpcClient,
      operationTag,
      hasPayload,
      actorName,
      entityId,
      operation["primaryKey"],
    ) as SingleRef<Op>["cast"],
  };
};

export const client = <Name extends string, Ops extends OperationDefinitions>(
  actor: ActorDefinition<Name, Ops>,
): Effect.Effect<(entityId: string) => Ref<Ops>, never, never> =>
  Effect.map(
    (actor.entity as unknown as { client: Effect.Effect<Function> }).client,
    (makeClient) =>
      (entityId: string): Ref<Ops> => {
        const rpcClient = makeClient(entityId) as Record<string, Function>;
        return buildRef(actor.name, entityId, actor.operations, rpcClient);
      },
  ) as Effect.Effect<(entityId: string) => Ref<Ops>, never, never>;
