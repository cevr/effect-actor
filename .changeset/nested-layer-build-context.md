---
"effect-encore": patch
---

`provideLayerBuildContext` no longer captures `CurrentAddress`, `CurrentRunnerAddress`, `ActorStateRegistry`, or `Scope` from the layer-build fiber. An actor layer built inside another actor's handler previously read the outer entity's address in its handler build.
