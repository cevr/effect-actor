import { Schema } from "effect";

export class CastReceipt extends Schema.Class<CastReceipt>("effect-actors/CastReceipt")({
  _tag: Schema.Literal("CastReceipt"),
  actorType: Schema.String,
  entityId: Schema.String,
  operation: Schema.String,
  primaryKey: Schema.String,
}) {}

export const makeCastReceipt = (options: {
  readonly actorType: string;
  readonly entityId: string;
  readonly operation: string;
  readonly primaryKey: string;
}): CastReceipt =>
  new CastReceipt({
    _tag: "CastReceipt",
    actorType: options.actorType,
    entityId: options.entityId,
    operation: options.operation,
    primaryKey: options.primaryKey,
  });
