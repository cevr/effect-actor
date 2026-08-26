import type { DateTime } from "effect";
import { Option, Predicate, Schema } from "effect";
import type { Entity as ClusterEntity } from "effect/unstable/cluster";
import type { ExecId } from "./receipt.js";
import { ExecIdCodec } from "./receipt.js";

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

export const isOpaquePayload = <Payload>(payload: Payload): boolean =>
  Schema.isSchema(payload) && !Predicate.hasProperty(payload, "fields");

export const resolveId = <Payload>(
  definition: OperationDef | void,
  payload: Payload,
  fallbackTag: string,
): OperationIdentityBase => {
  const id = definition?.id;
  if (!id) {
    return { entityId: fallbackTag, primaryKey: fallbackTag };
  }
  const result = Schema.decodeUnknownSync(EntityIdReturnSchema)(Reflect.apply(id, id, [payload]));
  if (isString(result)) {
    return { entityId: result, primaryKey: result };
  }
  return { entityId: result.entityId, primaryKey: result.primaryKey ?? result.entityId };
};

interface OperationIdentityBase {
  readonly entityId: string;
  readonly primaryKey: string;
}

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
