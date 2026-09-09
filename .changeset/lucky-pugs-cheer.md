---
"effect-encore": minor
---

Export `ActorStateRegistry` and its query functions from the package root

`Actor.toLayer` merges `ActorStateRegistry.Live` into the consumer's context, so
the registry was already reachable at runtime — but the Tag was not exported,
leaving no way to name it.

That left the actor's own `State` client as the only route to enumerate live
entities, which is unusable from anything built _beneath_ the actor: requiring
`ActorStateClientService<Name>` there makes the layer that builds the actor
depend on the actor it builds.

Now exported: `ActorStateRegistry`, `ActorStateRegistryService`,
`listStateEntityIds`, `stateOf`, `watchStateOf`, and `waitForStateOf`. The
decode plumbing (`makeActorStateObservation`) stays internal.
