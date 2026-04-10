import { describe, expect, it } from "bun:test";
import { makeCastReceipt } from "../src/receipt.js";

describe("CastReceipt", () => {
  it("is serializable — roundtrips through JSON", () => {
    const receipt = makeCastReceipt({
      actorType: "MyActor",
      entityId: "e-1",
      operation: "DoWork",
      primaryKey: "pk-1",
    });

    const json = JSON.stringify(receipt);
    const parsed = JSON.parse(json);
    expect(parsed._tag).toBe("CastReceipt");
    expect(parsed.actorType).toBe("MyActor");
    expect(parsed.entityId).toBe("e-1");
    expect(parsed.operation).toBe("DoWork");
    expect(parsed.primaryKey).toBe("pk-1");
  });

  it("carries actorType, entityId, operation, primaryKey", () => {
    const receipt = makeCastReceipt({
      actorType: "Order",
      entityId: "ord-123",
      operation: "Validate",
      primaryKey: "key-abc",
    });

    expect(receipt._tag).toBe("CastReceipt");
    expect(receipt.actorType).toBe("Order");
    expect(receipt.entityId).toBe("ord-123");
    expect(receipt.operation).toBe("Validate");
    expect(receipt.primaryKey).toBe("key-abc");
  });

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
