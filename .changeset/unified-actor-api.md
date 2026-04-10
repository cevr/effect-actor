---
"effect-encore": minor
---

Unified Actor API with value-dispatch and layer-based lifecycle

- `Actor.toLayer(actor)` — client-only layer (producer)
- `Actor.toLayer(actor, handlers)` — consumer + producer layer (registers entity + provides Context)
- `Actor.toTestLayer(actor, handlers)` — test layer via Entity.makeTestClient, provides Context
- `.actor(id)` — yields an ActorRef from context: `const ref = yield* Counter.actor("id")`
- Removed `Actor.Live` — folded into `Actor.toLayer`
- Removed `Actor.Test` — replaced by `Actor.toTestLayer` (returns Layer, not Effect)
- `Actor.Test` now accepts raw handlers instead of pre-built layers
- Added `"actor"` to reserved operation names
