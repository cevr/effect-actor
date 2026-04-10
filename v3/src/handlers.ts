import type { Effect, Layer } from "effect";
import type { Entity } from "@effect/cluster";
import type { Rpc } from "@effect/rpc";
import type { ActorDefinition, ActorRpcs, OperationConfigs } from "./actor.js";

export interface HandlerOptions {
  readonly spanAttributes?: Record<string, string>;
  readonly maxIdleTime?: number;
  readonly concurrency?: number | "unbounded";
  readonly mailboxCapacity?: number | "unbounded";
}

export const handlers = <
  Name extends string,
  Ops extends OperationConfigs,
  Rpcs extends Rpc.Any = ActorRpcs<Ops>,
  Handlers extends Entity.HandlersFrom<Rpcs> = Entity.HandlersFrom<Rpcs>,
>(
  actor: ActorDefinition<Name, Ops, Rpcs>,
  build: Handlers | Effect.Effect<Handlers>,
  options?: HandlerOptions,
): Layer.Layer<never> => {
  return actor.entity.toLayer(build as Entity.HandlersFrom<Rpcs>, {
    spanAttributes: options?.spanAttributes,
    maxIdleTime: options?.maxIdleTime,
    concurrency: options?.concurrency,
    mailboxCapacity: options?.mailboxCapacity,
  }) as Layer.Layer<never>;
};
