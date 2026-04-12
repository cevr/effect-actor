// ── Observability ─────────────────────────────────────────────────────────
//
// Effect Cluster automatically creates spans for every handler invocation:
//   `${entityType}(${entityId}).${rpcTag}`
//
// This is done by the entity manager setting `spanPrefix` and RpcServer
// wrapping each handler in `Effect.withSpan`. No custom RpcMiddleware needed.
//
// To add custom attributes to these spans, pass `spanAttributes` to
// `Actor.toLayer(actor, build, { spanAttributes: { ... } })`.
//
// For advanced use cases (custom middleware, auth, rate limiting), use
// `Actor.withProtocol` to transform the underlying RpcGroup protocol:
//
//   import { Actor } from "effect-encore"
//
//   const MyActor = Actor.fromEntity("MyActor", defs).pipe(
//     Actor.withProtocol((protocol) => protocol.middleware(MyMiddleware)),
//   )

export { CurrentAddress } from "effect/unstable/cluster/Entity";

export const defaultSpanAttributes = (actorName: string): Record<string, string> => ({
  "actor.name": actorName,
  "actor.library": "effect-encore",
});
