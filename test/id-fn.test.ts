import { describe, expect, test } from "effect-bun-test";
import { Schema } from "effect";
import { Actor } from "../src/index.js";

describe("OperationDef.id (string return)", () => {
  test("string-form id maps entityId === primaryKey", () => {
    const A = Actor.fromEntity("A", {
      Op: {
        payload: { x: Schema.String },
        id: (p: { x: string }) => p.x,
      },
    });
    const def = A._meta.definitions["Op"];
    expect(def.id).toBeDefined();
    const id: (payload: { readonly x: string }) => string = def.id;
    const r = id({ x: "k" });
    expect(r).toBe("k");
  });
});

describe("OperationDef.id (object return)", () => {
  test("object-form with primaryKey absent defaults primaryKey to entityId", () => {
    const A = Actor.fromEntity("A", {
      Op: {
        payload: { x: Schema.String },
        id: (p: { x: string }) => ({ entityId: p.x }),
      },
    });
    const def = A._meta.definitions["Op"];
    const id: (payload: { readonly x: string }) => {
      readonly entityId: string;
      readonly primaryKey?: string;
    } = def.id;
    const r = id({ x: "k" });
    expect(r.entityId).toBe("k");
    expect(r.primaryKey).toBeUndefined();
  });

  test("object-form with primaryKey present diverges from entityId", () => {
    const A = Actor.fromEntity("A", {
      Op: {
        payload: { dedup: Schema.String, action: Schema.String },
        id: (p: { dedup: string; action: string }) => ({
          entityId: p.dedup,
          primaryKey: `${p.dedup}:${p.action}`,
        }),
      },
    });
    const def = A._meta.definitions["Op"];
    const id: (payload: { readonly dedup: string; readonly action: string }) => {
      readonly entityId: string;
      readonly primaryKey?: string;
    } = def.id;
    const r = id({
      dedup: "k",
      action: "trigger",
    });
    expect(r.entityId).toBe("k");
    expect(r.primaryKey).toBe("k:trigger");
  });
});

describe("WorkflowDef.id (string-only constraint)", () => {
  test("workflow accepts string-form id", () => {
    const W = Actor.fromWorkflow("W", {
      payload: { name: Schema.String },
      id: (p: { name: string }) => p.name,
    });
    expect(W._tag).toBe("WorkflowActor");
  });

  test("workflow rejects object-form id at the type level", () => {
    Actor.fromWorkflow("W", {
      payload: { name: Schema.String },
      // @ts-expect-error — object-form id is invalid for WorkflowDef
      id: (p: { name: string }) => ({ entityId: p.name }),
    });
  });
});
