import { CurrentAddress } from "effect/unstable/cluster/Entity";
import type { EntityAddress } from "effect/unstable/cluster";
import { Context, Data, Effect, Layer, Option, Ref, Stream } from "effect";
import type { Scope } from "effect";
import * as State from "./state.js";

export class ActorStateUnavailable extends Data.TaggedError(
  "effect-encore/actor-state/ActorStateUnavailable",
)<{
  readonly entityType: string;
  readonly entityId: string;
}> {}

/**
 * Registry-internal read-only view of an entity's live state: a current-value
 * read plus a change stream. Derived from a {@link State.State} by
 * {@link registerState}; the public state vocabulary is `State<A>`. Not
 * exported — the package barrel surfaces `State<A>` (see `index.ts`), not this
 * handle.
 */
interface ActorStateHandle<StateValue, Error = never, Requirements = never> {
  readonly get: Effect.Effect<StateValue, Error, Requirements>;
  readonly watch: Stream.Stream<StateValue, Error, Requirements>;
}

type AnyActorStateHandle = ActorStateHandle<unknown, unknown, unknown>;

function eraseActorStateHandle<StateValue, Error, Requirements>(
  handle: ActorStateHandle<StateValue, Error, Requirements>,
): AnyActorStateHandle;
function eraseActorStateHandle(handle: AnyActorStateHandle): AnyActorStateHandle {
  return handle;
}

function restoreActorStateHandle<StateValue, Error, Requirements>(
  handle: AnyActorStateHandle,
): ActorStateHandle<StateValue, Error, Requirements>;
function restoreActorStateHandle(handle: AnyActorStateHandle): AnyActorStateHandle {
  return handle;
}

export interface ActorStateRegistryService {
  readonly register: (
    address: EntityAddress.EntityAddress,
    handle: AnyActorStateHandle,
  ) => Effect.Effect<void>;
  readonly deregister: (
    address: EntityAddress.EntityAddress,
    handle: AnyActorStateHandle,
  ) => Effect.Effect<void>;
  readonly get: (
    address: EntityAddress.EntityAddress,
  ) => Effect.Effect<AnyActorStateHandle, ActorStateUnavailable>;
  readonly list: (entityType: string) => Effect.Effect<ReadonlyArray<string>>;
}

export class ActorStateRegistry extends Context.Service<
  ActorStateRegistry,
  ActorStateRegistryService
>()("effect-encore/actor-state/ActorStateRegistry") {
  static Live: Layer.Layer<ActorStateRegistry> = Layer.effect(
    ActorStateRegistry,
    Effect.gen(function* () {
      const entries = yield* Ref.make<ReadonlyMap<string, AnyActorStateHandle>>(new Map());

      return ActorStateRegistry.of({
        register: (address, handle) =>
          Ref.update(entries, (current) => {
            const next = new Map(current);
            next.set(addressKey(address), handle);
            return next;
          }),
        deregister: (address, handle) =>
          Ref.update(entries, (current) => {
            const key = addressKey(address);
            if (current.get(key) !== handle) return current;
            const next = new Map(current);
            next.delete(key);
            return next;
          }),
        get: (address) =>
          Ref.get(entries).pipe(
            Effect.flatMap((current) => {
              const handle = Option.fromNullishOr(current.get(addressKey(address)));
              if (Option.isNone(handle)) {
                return Effect.fail(
                  new ActorStateUnavailable({
                    entityType: String(address.entityType),
                    entityId: String(address.entityId),
                  }),
                );
              }
              return Effect.succeed(handle.value);
            }),
          ),
        list: (entityType) =>
          Ref.get(entries).pipe(
            Effect.map((current) =>
              Array.from(current.keys()).flatMap((key) => {
                const parsed = parseAddressKey(key);
                if (parsed.entityType !== entityType) return [];
                return [parsed.entityId];
              }),
            ),
          ),
      });
    }),
  );
}

export const registerState = <A, Error = never, Requirements = never>(
  state: State.State<A, Error, Requirements>,
): Effect.Effect<void, never, ActorStateRegistry | CurrentAddress | Scope.Scope> =>
  Effect.gen(function* () {
    const registry = yield* ActorStateRegistry;
    const address = yield* CurrentAddress;
    const handle = {
      get: State.get(state),
      watch: State.changes(state),
    } satisfies ActorStateHandle<A, Error, Requirements>;
    const erased = eraseActorStateHandle(handle);
    yield* registry.register(address, erased);
    yield* Effect.addFinalizer(() => registry.deregister(address, erased));
  });

export const stateOf = <State, Error = never, Requirements = never>(
  address: EntityAddress.EntityAddress,
): Effect.Effect<State, Error | ActorStateUnavailable, ActorStateRegistry | Requirements> =>
  Effect.gen(function* () {
    const registry = yield* ActorStateRegistry;
    const erased = yield* registry.get(address);
    const handle = restoreActorStateHandle<State, Error, Requirements>(erased);
    return yield* handle.get;
  });

export const watchStateOf = <State, Error = never, Requirements = never>(
  address: EntityAddress.EntityAddress,
): Stream.Stream<State, Error | ActorStateUnavailable, ActorStateRegistry | Requirements> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const registry = yield* ActorStateRegistry;
      const erased = yield* registry.get(address);
      const handle = restoreActorStateHandle<State, Error, Requirements>(erased);
      return handle.watch;
    }),
  );

export const listStateEntityIds = (
  entityType: string,
): Effect.Effect<ReadonlyArray<string>, never, ActorStateRegistry> =>
  Effect.gen(function* () {
    const registry = yield* ActorStateRegistry;
    return yield* registry.list(entityType);
  });

export const waitForStateOf = <State, Error = never, Requirements = never>(
  address: EntityAddress.EntityAddress,
  predicate: (state: State) => boolean,
): Effect.Effect<State, Error | ActorStateUnavailable, ActorStateRegistry | Requirements> =>
  watchStateOf<State, Error, Requirements>(address).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.flatMap((option) =>
      Option.match(option, {
        onNone: () =>
          Effect.die(
            new Error(
              `effect-encore/waitForStateOf: state stream ended before predicate matched for ${String(address.entityType)}:${String(address.entityId)}`,
            ),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );

export interface ActorStateObservation<State, Error, Requirements> {
  readonly get: (
    address: EntityAddress.EntityAddress,
  ) => Effect.Effect<State, Error | ActorStateUnavailable, ActorStateRegistry | Requirements>;
  readonly watch: (
    address: EntityAddress.EntityAddress,
  ) => Stream.Stream<State, Error | ActorStateUnavailable, ActorStateRegistry | Requirements>;
  readonly waitFor: (
    address: EntityAddress.EntityAddress,
    predicate: (state: State) => boolean,
  ) => Effect.Effect<State, Error | ActorStateUnavailable, ActorStateRegistry | Requirements>;
}

export const makeActorStateObservation = <Input, State, Error, Requirements>(options: {
  readonly decodeState: (value: Input) => Effect.Effect<State, Error, Requirements>;
  readonly decodeFailure: (cause: unknown) => Effect.Effect<never, Error, Requirements>;
}): ActorStateObservation<State, Error, Requirements> => {
  const watch = (address: EntityAddress.EntityAddress) =>
    watchStateOf<Input, Error, Requirements>(address).pipe(
      Stream.catch((cause: Error | ActorStateUnavailable) =>
        Stream.fromEffect(options.decodeFailure(cause)),
      ),
      Stream.mapEffect(options.decodeState),
    );

  return {
    get: (address) =>
      stateOf<Input, Error, Requirements>(address).pipe(
        Effect.catch(options.decodeFailure),
        Effect.flatMap(options.decodeState),
      ),
    watch,
    waitFor: (address, predicate) =>
      watch(address).pipe(
        Stream.filter(predicate),
        Stream.runHead,
        Effect.flatMap((option) =>
          Option.match(option, {
            onNone: () =>
              Effect.die(
                new Error(
                  `effect-encore/waitForState: state stream ended before predicate matched for ${String(address.entityType)}:${String(address.entityId)}`,
                ),
              ),
            onSome: Effect.succeed,
          }),
        ),
      ),
  };
};

const addressKey = (address: EntityAddress.EntityAddress): string =>
  `${String(address.entityType)}\x00${String(address.entityId)}`;

interface AddressKeyParts {
  readonly entityType: string;
  readonly entityId: string;
}

const parseAddressKey = (key: string): AddressKeyParts => {
  const first = key.indexOf("\x00");
  if (first < 0) {
    return { entityType: key, entityId: "" };
  }
  return { entityType: key.slice(0, first), entityId: key.slice(first + 1) };
};
