import { Effect } from "effect";
import type { Layer, Scope } from "effect";
import { Entity } from "effect/unstable/cluster";
import type {
  ActorDefinition,
  OperationDefinition,
  OperationDefinitions,
  SingleActorDefinition,
} from "./actor.js";
import { buildRef, buildSingleRef } from "./client.js";
import type { Ref, SingleRef } from "./client.js";

export const testClient = <Name extends string, Ops extends OperationDefinitions>(
  actor: ActorDefinition<Name, Ops>,
  handlerLayer: Layer.Layer<never, never, never>,
): Effect.Effect<(entityId: string) => Effect.Effect<Ref<Ops>>, never, Scope.Scope> =>
  Effect.map(
    Entity.makeTestClient(
      actor.entity,
      handlerLayer as Layer.Layer<never, never, never>,
    ) as Effect.Effect<
      (entityId: string) => Effect.Effect<Record<string, Function>>,
      never,
      Scope.Scope
    >,
    (makeClient) =>
      (entityId: string): Effect.Effect<Ref<Ops>> =>
        Effect.map(makeClient(entityId), (rpcClient) =>
          buildRef(actor.name, entityId, actor.operations, rpcClient),
        ),
  );

export const testSingleClient = <Name extends string, Op extends OperationDefinition>(
  actor: SingleActorDefinition<Name, Op>,
  handlerLayer: Layer.Layer<never, never, never>,
): Effect.Effect<(entityId: string) => Effect.Effect<SingleRef<Op>>, never, Scope.Scope> =>
  Effect.map(
    Entity.makeTestClient(
      actor.entity,
      handlerLayer as Layer.Layer<never, never, never>,
    ) as Effect.Effect<
      (entityId: string) => Effect.Effect<Record<string, Function>>,
      never,
      Scope.Scope
    >,
    (makeClient) =>
      (entityId: string): Effect.Effect<SingleRef<Op>> =>
        Effect.map(makeClient(entityId), (rpcClient) =>
          buildSingleRef(actor.name, entityId, actor.operationTag, actor.operation, rpcClient),
        ),
  );
