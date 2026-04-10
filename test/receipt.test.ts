import { describe, it } from "bun:test";

describe("CastReceipt", () => {
  it.todo("is serializable — roundtrips through JSON", () => {});
  it.todo("carries actorType, entityId, operation, primaryKey", () => {});
  it.todo("duplicate primaryKey is idempotent — same receipt for same key", () => {});
});

describe("Actor.peek", () => {
  it.todo("returns Pending when handler has not completed", () => {});
  it.todo("returns Success with decoded value when handler succeeds", () => {});
  it.todo("returns Failure with decoded error when handler fails", () => {});
  it.todo("returns Interrupted when handler is interrupted", () => {});
  it.todo("returns Defect with cause when handler defects", () => {});
  it.todo("requires actor definition for schema decoding — not standalone", () => {});
  it.todo("uses requestIdForPrimaryKey to resolve receipt to Snowflake", () => {});
  it.todo("reads repliesForUnfiltered with resolved Snowflake", () => {});
});
