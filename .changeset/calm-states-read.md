---
"effect-encore": minor
---

Add the `ReadableState` type and `State.makeReadable` constructor for actor state that another service owns. Widen `Actor.registerState` to accept the read-only view and capture its service context at registration.
