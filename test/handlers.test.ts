import { describe, it } from "bun:test";

describe("Actor.handlers", () => {
  it.todo("wires plain handler functions to Entity.toLayer", () => {});
  it.todo("supports Effect.gen for handlers that need services", () => {});
  it.todo("handler return value becomes the RPC reply — no explicit .reply()", () => {});
  it.todo("handler errors become RPC errors", () => {});
  it.todo("handler receives envelope with payload, entityId, operation tag", () => {});
});
