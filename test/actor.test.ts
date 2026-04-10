import { describe, it } from "bun:test";

describe("Actor.make", () => {
  it.todo("defines a multi-operation actor with typed payload/success/error schemas", () => {});
  it.todo("attaches persisted annotation when persisted: true", () => {});
  it.todo("attaches primaryKey extractor from definition", () => {});
  it.todo("attaches deliverAt schedule from definition", () => {});
  it.todo("compiles operations into RpcGroup under the hood", () => {});
});

describe("Actor.single", () => {
  it.todo("defines a single-operation actor — no operation namespace on ref", () => {});
  it.todo("supports same options as multi-operation (persisted, primaryKey, deliverAt)", () => {});
});

describe("Actor.client", () => {
  it.todo("returns a function (entityId) => Ref with typed operations", () => {});
  it.todo("requires Entity.client in the Effect context", () => {});
});
