import { describe, expect, it } from "bun:test";
import { Observability } from "../src/index.js";

describe("observability", () => {
  it("defaultSpanAttributes returns actor metadata", () => {
    const attrs = Observability.defaultSpanAttributes("MyActor");
    expect(attrs["actor.name"]).toBe("MyActor");
    expect(attrs["actor.library"]).toBe("effect-actors");
  });

  it("re-exports CurrentAddress for custom middleware users", () => {
    expect(Observability.CurrentAddress).toBeDefined();
  });
});
