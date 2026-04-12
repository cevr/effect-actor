---
"effect-encore": minor
---

Add `flush` and `redeliver` methods to entity ActorObject.

- `actor.flush(actorId)` — delete all messages and replies via `MessageStorage.clearAddress`
- `actor.redeliver(actorId)` — clear read leases so messages re-enter polling via `MessageStorage.resetAddress`

Both require `MessageStorage | Sharding` in the Effect context (same as `peek`/`watch`).

Fix shard group derivation in `peek`/`flush`/`redeliver` to use `entity.getShardGroup` instead of actor name. The previous implementation computed wrong shard IDs (e.g. `"VectorUpdate:1"` instead of `"default:1"`), which would have caused `resetAddress` to silently no-op.
