import { describe, it } from "bun:test";

describe("cluster integration", () => {
  it.todo("Actor.make → handlers → client → call round-trip through Entity", () => {});
  it.todo("Actor.make → handlers → client → cast → peek round-trip with persistence", () => {});
  it.todo("cast returns after persistence, before handler completion", () => {});
  it.todo("peek returns Pending then Success as handler completes", () => {});
  it.todo("failure/defect/interruption decode correctly from WithExit", () => {});
  it.todo("duplicate receiptId (primaryKey) is idempotent", () => {});
  it.todo("missing MessageStorage fails cast at runtime, not silently", () => {});
});
