---
"effect-encore": patch
---

Fix `Actor.toLayer` layer composition — use `Layer.provideMerge` instead of `Layer.merge` for handler+client layers. The client layer needs Sharding from the handler layer's output; `Layer.merge` treated them as peers, causing "Service not found: Sharding" when consumers provided ClusterRuntime after the actor layer.
