import type { Effect } from "effect";
import type { Entity } from "effect/unstable/cluster";
import type { Rpc } from "effect/unstable/rpc";
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
  RX = never,
>(
  actor: ActorDefinition<Name, Ops, Rpcs>,
  build: Handlers | Effect.Effect<Handlers, never, RX>,
  options?: HandlerOptions,
) =>
  actor.entity.toLayer(build, {
    spanAttributes: options?.spanAttributes,
    maxIdleTime: options?.maxIdleTime,
    concurrency: options?.concurrency,
    mailboxCapacity: options?.mailboxCapacity,
  });
