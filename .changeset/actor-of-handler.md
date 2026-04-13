---
"effect-encore": patch
---

Add `.of` typed identity method on `EntityActor` for type-safe handler construction.

- `actor.of(handlers)` — returns handlers unchanged but infers types from the actor's operation defs
- Eliminates manual type annotations when building handlers inside `Effect.gen`
- Added `"of"` to reserved operation/signal names
