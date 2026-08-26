import type { DateTime, Schema as SchemaType } from "effect";
import { Context, Effect, Option, Predicate, PrimaryKey, Schema } from "effect";
import {
  ClusterSchema,
  type Entity as ClusterEntity,
  type EntityAddress,
  Envelope,
  Message,
  type Snowflake,
} from "effect/unstable/cluster";
import * as DeliverAt from "effect/unstable/cluster/DeliverAt";
import * as Headers from "effect/unstable/http/Headers";
import type { Rpc } from "effect/unstable/rpc";
import { Rpc as RpcMod } from "effect/unstable/rpc";
import { ActorDefect } from "../actor-defect.js";
import type { ExecId } from "../receipt.js";
import { ExecIdCodec } from "../receipt.js";

export type EntityIdReturn = string | { readonly entityId: string; readonly primaryKey?: string };

export interface OperationDef {
  readonly payload?: Schema.Top | Schema.Struct.Fields;
  readonly success?: Schema.Top;
  readonly error?: Schema.Top;
  readonly persisted?: boolean;
  readonly id: (payload: never) => EntityIdReturn;
  readonly deliverAt?: (payload: never) => DateTime.DateTime;
}

export type OperationDefs = Record<string, OperationDef>;

const EntityIdReturnSchema = Schema.Union([
  Schema.String,
  Schema.Struct({
    entityId: Schema.String,
    primaryKey: Schema.optionalKey(Schema.String),
  }),
]);

const isString = Schema.is(Schema.String);

export interface OperationIdentity {
  readonly entityId: string;
  readonly primaryKey: string;
  readonly execId: ExecId;
}

export interface Invocation {
  // eslint-disable-next-line typescript-eslint/no-explicit-any -- Entity protocols are type-erased inside transport.
  readonly entity: ClusterEntity.Entity<string, any>;
  readonly tag: string;
  readonly definition: OperationDef;
  readonly payload: unknown;
  readonly operation: OperationValue;
  readonly identity: OperationIdentity;
}

export interface OperationValue {
  readonly _tag: string;
  readonly _payload?: unknown;
}

interface OperationIdentityBase {
  readonly entityId: string;
  readonly primaryKey: string;
}

export const isOpaquePayload = <Payload>(payload: Payload): boolean =>
  Schema.isSchema(payload) && !Predicate.hasProperty(payload, "fields");

export const resolveId = <Payload>(
  definition: OperationDef | void,
  payload: Payload,
  fallbackTag: string,
): OperationIdentityBase => {
  const id = definition?.id;
  if (!id) return { entityId: fallbackTag, primaryKey: fallbackTag };
  const result = Schema.decodeUnknownSync(EntityIdReturnSchema)(Reflect.apply(id, id, [payload]));
  if (isString(result)) return { entityId: result, primaryKey: result };
  return { entityId: result.entityId, primaryKey: result.primaryKey ?? result.entityId };
};

export const makeOperationValue = <Payload>(
  definition: OperationDef | void,
  tag: string,
  payload: Payload,
): OperationValue => {
  const payloadSchema = Option.fromNullishOr(definition?.payload);
  if (Option.isSome(payloadSchema) && isOpaquePayload(payloadSchema.value)) {
    return { _tag: tag, _payload: payload };
  }
  if (Predicate.isObjectOrArray(payload)) {
    return Object.assign(Object.create(Object.getPrototypeOf(payload)), payload, { _tag: tag });
  }
  return { _tag: tag };
};

export const payloadFromOperation = (
  definition: OperationDef | void,
  operation: OperationValue,
): unknown => {
  const payloadSchema = Option.fromNullishOr(definition?.payload);
  if (
    Option.isSome(payloadSchema) &&
    isOpaquePayload(payloadSchema.value) &&
    Predicate.hasProperty(operation, "_payload")
  ) {
    return operation["_payload"];
  }
  return operation;
};

export const compileInvocation = <Payload>(
  // eslint-disable-next-line typescript-eslint/no-explicit-any -- Entity protocols are type-erased inside transport.
  entity: ClusterEntity.Entity<string, any>,
  tag: string,
  definition: OperationDef,
  payload: Payload,
): Invocation => {
  const operation = makeOperationValue(definition, tag, payload);
  const { entityId, primaryKey } = resolveId(definition, payload, tag);
  return {
    entity,
    tag,
    definition,
    payload,
    operation,
    identity: {
      entityId,
      primaryKey,
      execId: ExecIdCodec.encode({ entityId, tag, primaryKey }),
    },
  };
};

/* oxlint-disable effect/noAs, effect/noChainedTypeAssertions, effect/noKnownValueWidening, effect/noUnknownParameters, effect/noUnsafeDictionaryType -- Effect Cluster erases schema-specific RPC types at this compiler seam. */

export const compileRpc = (actorName: string, tag: string, def: OperationDef): Rpc.Any => {
  const options: Record<string, unknown> = {};
  const payload = def["payload"];
  const deliverAt = def["deliverAt"];
  const primaryKeyOf = (input: unknown) => resolveId(def, input, tag).primaryKey;

  if (payload) {
    if (Schema.isSchema(payload)) {
      options["payload"] = payload;
    } else {
      const Base = Schema.Class<Record<string, unknown>>(
        `effect-encore/${actorName}/${tag}/Payload`,
      )(payload);
      class PayloadClass extends Base {}
      const proto = PayloadClass.prototype as Record<string | symbol, unknown>;
      proto[PrimaryKey.symbol] = function (this: unknown) {
        return primaryKeyOf(this);
      };
      if (deliverAt) {
        proto[DeliverAt.symbol] = function (this: unknown) {
          return (deliverAt as Function)(this) as DateTime.DateTime;
        };
      }
      options["payload"] = PayloadClass;
    }
  } else {
    const Base = Schema.Class<Record<string, unknown>>(`effect-encore/${actorName}/${tag}/Payload`)(
      {},
    );
    class EmptyPayloadClass extends Base {}
    (EmptyPayloadClass.prototype as Record<string | symbol, unknown>)[PrimaryKey.symbol] =
      function () {
        return primaryKeyOf(Schema.Void.make());
      };
    options["payload"] = EmptyPayloadClass;
  }

  if (def["success"]) options["success"] = def["success"];
  if (def["error"]) options["error"] = def["error"];

  let rpc: Rpc.Any = (RpcMod.make as Function)(tag, options) as Rpc.Any;
  if (def["persisted"]) {
    rpc = (rpc as unknown as { annotate: Function }).annotate(
      ClusterSchema.Persisted,
      true,
    ) as Rpc.Any;
  }
  return rpc;
};

interface ErasedRequestOptions {
  readonly requestId: Snowflake.Snowflake;
  readonly address: EntityAddress.EntityAddress;
  readonly tag: string;
  readonly payload: unknown;
  readonly headers: Headers.Headers;
}

function makeErasedRequest(options: ErasedRequestOptions): Envelope.Request<Rpc.AnyWithProps>;
function makeErasedRequest(options: ErasedRequestOptions): unknown {
  return Reflect.apply(Envelope.makeRequest, Envelope, [options]);
}

interface ErasedOutgoingRequestOptions {
  readonly rpc: Rpc.AnyWithProps;
  readonly context: Context.Context<never>;
  readonly envelope: Envelope.Request<Rpc.AnyWithProps>;
  readonly lastReceivedReply: Option.Option<never>;
  readonly respond: () => Effect.Effect<void>;
  readonly annotations: Context.Context<never>;
}

function makeErasedOutgoingRequest(
  options: ErasedOutgoingRequestOptions,
): Message.OutgoingRequest<Rpc.Any>;
function makeErasedOutgoingRequest(options: ErasedOutgoingRequestOptions): unknown {
  return Reflect.construct(Message.OutgoingRequest, [options]);
}

export const compileOutgoingRequest = (
  invocation: Invocation,
  address: EntityAddress.EntityAddress,
  snowflakeGenerator: Snowflake.Generator["Service"],
): Effect.Effect<Message.OutgoingRequest<Rpc.Any>> =>
  Effect.gen(function* () {
    const { entity, tag, definition, operation } = invocation;
    const rpc = entity.protocol.requests.get(tag);
    if (!rpc) {
      return yield* Effect.die(
        new ActorDefect({
          message: `effect-encore: rpc "${tag}" not found on entity "${entity.type}"`,
        }),
      );
    }

    const payloadSchema: SchemaType.Top = rpc.payloadSchema;
    let payload;
    if (!definition.payload) {
      payload = payloadSchema.make({});
    } else if (isOpaquePayload(definition.payload)) {
      payload = operation["_payload"];
    } else {
      const { _tag: operationTag, ...fields } = operation;
      void operationTag;
      payload = payloadSchema.make(fields);
    }

    const context = yield* Effect.context<never>();
    const envelope = makeErasedRequest({
      requestId: snowflakeGenerator.nextUnsafe(),
      address,
      tag,
      payload,
      headers: Headers.empty,
    });
    const rpcAnnotations: Context.Context<never> = rpc.annotations;
    const dynamic = Context.get(rpcAnnotations, ClusterSchema.Dynamic);
    const annotations = dynamic(rpcAnnotations, envelope);

    return makeErasedOutgoingRequest({
      rpc,
      context,
      envelope,
      lastReceivedReply: Option.none(),
      respond: () => Effect.void,
      annotations,
    });
  });

/* oxlint-enable effect/noAs, effect/noChainedTypeAssertions, effect/noKnownValueWidening, effect/noUnknownParameters, effect/noUnsafeDictionaryType */
