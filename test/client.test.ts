import { describe, it } from "bun:test";

describe("Ref.call", () => {
  it.todo("sends message and awaits handler completion — returns success value", () => {});
  it.todo("surfaces handler errors in the error channel", () => {});
  it.todo("surfaces handler defects as defects", () => {});
  it.todo("works without MessageStorage (non-persisted path)", () => {});
});

describe("Ref.cast", () => {
  it.todo("sends persisted message with discard: true — returns CastReceipt immediately", () => {});
  it.todo("handler runs to completion after cast returns", () => {});
  it.todo("receipt contains actorType, entityId, operation, primaryKey", () => {});
  it.todo("requires MessageStorage in context — fails loudly without it", () => {});
  it.todo("auto-generates primaryKey when payload has no PrimaryKey implementation", () => {});
});

describe("Ref.watch", () => {
  it.todo("returns Stream that polls for reply state changes", () => {});
  it.todo("emits Pending then Success when handler completes", () => {});
  it.todo("completes the stream on terminal result (Success/Failure/Interrupted/Defect)", () => {});
  it.todo("respects configurable poll interval", () => {});
});

describe("single-operation ref", () => {
  it.todo("call/cast/watch are directly on ref — no operation namespace", () => {});
});
