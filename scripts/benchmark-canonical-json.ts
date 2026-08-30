import { BunCrypto } from "@effect/platform-bun";
import { Crypto, Effect, Encoding, ManagedRuntime, Order, Schema } from "effect";
import { canonicalJsonSha256, canonicalJsonString } from "../src/canonical-json.js";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json));
const textEncoder = new TextEncoder();

const legacyCanonicalJsonString = (value: Schema.Json): string => {
  if (Array.isArray(value)) return `[${value.map(legacyCanonicalJsonString).join(",")}]`;
  if (!Schema.is(Schema.JsonObject)(value)) return encodeJson(value);
  return `{${Object.entries(value)
    .sort(([left], [right]) => Order.String(left, right))
    .map(([key, entry]) => `${encodeJson(key)}:${legacyCanonicalJsonString(entry)}`)
    .join(",")}}`;
};

const deepJson = (depth: number): Schema.Json => {
  let value: Schema.Json = 0;
  for (let index = 0; index < depth; index++) value = { value };
  return value;
};

const legacyCanonicalJsonSha256 = Effect.fn("benchmark/legacyCanonicalJsonSha256")(function* (
  value: Schema.Json,
) {
  const crypto = yield* Crypto.Crypto;
  const digest = yield* crypto.digest(
    "SHA-256",
    textEncoder.encode(legacyCanonicalJsonString(value)),
  );
  return Encoding.encodeHex(digest);
});

const fixtures: ReadonlyArray<{
  readonly name: string;
  readonly iterations: number;
  readonly value: Schema.Json;
}> = [
  {
    name: "flat object, 100 keys",
    iterations: 1_000,
    value: Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`key-${99 - index}`, index]),
    ),
  },
  {
    name: "nested object, 100 keys",
    iterations: 500,
    value: Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `key-${99 - index}`,
        { a: [index, index + 1, index + 2], z: index },
      ]),
    ),
  },
  {
    name: "integer-key object, 100 keys",
    iterations: 1_000,
    value: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [String(index), index])),
  },
  {
    name: "array, 1,000 items",
    iterations: 500,
    value: Array.from({ length: 1_000 }, (_, index) => index),
  },
  {
    name: "object, depth 5,000",
    iterations: 3,
    value: deepJson(5_000),
  },
];

const measure = (iterations: number, operation: () => string): number => {
  operation();
  const samples: Array<number> = [];
  for (let sample = 0; sample < 5; sample++) {
    const startedAt = Bun.nanoseconds();
    for (let index = 0; index < iterations; index++) operation();
    samples.push((Bun.nanoseconds() - startedAt) / iterations);
  }
  samples.sort((left, right) => left - right);
  return samples[2];
};

const measureEffect = (
  iterations: number,
  operation: Effect.Effect<string, unknown, Crypto.Crypto>,
): Effect.Effect<number, unknown, Crypto.Crypto> =>
  Effect.gen(function* () {
    yield* operation;
    const samples: Array<number> = [];
    for (let sample = 0; sample < 5; sample++) {
      const startedAt = Bun.nanoseconds();
      for (let index = 0; index < iterations; index++) {
        yield* operation;
      }
      samples.push((Bun.nanoseconds() - startedAt) / iterations);
    }
    samples.sort((left, right) => left - right);
    return samples[2];
  });

console.log("fixture\tlegacy ns/op\tcurrent ns/op\tspeedup");
for (const fixture of fixtures) {
  const expected = legacyCanonicalJsonString(fixture.value);
  const actual = canonicalJsonString(fixture.value);
  if (actual !== expected) {
    throw new Error(`canonical JSON mismatch for ${fixture.name}`);
  }

  const legacy = measure(fixture.iterations, () => legacyCanonicalJsonString(fixture.value));
  const current = measure(fixture.iterations, () => canonicalJsonString(fixture.value));
  console.log(
    `${fixture.name}\t${legacy.toFixed(0)}\t${current.toFixed(0)}\t${(legacy / current).toFixed(1)}x`,
  );
}

const runtime = ManagedRuntime.make(BunCrypto.layer);
const hashFixture = fixtures[1];
if (hashFixture === undefined) throw new Error("hash benchmark fixture is missing");
const legacyHash = await runtime.runPromise(
  measureEffect(100, legacyCanonicalJsonSha256(hashFixture.value)),
);
const currentHash = await runtime.runPromise(
  measureEffect(100, canonicalJsonSha256(hashFixture.value)),
);
console.log("\nEffect SHA-256 fixture\tlegacy ns/op\tcurrent ns/op\tspeedup");
console.log(
  `${hashFixture.name}\t${legacyHash.toFixed(0)}\t${currentHash.toFixed(0)}\t${(legacyHash / currentHash).toFixed(1)}x`,
);
await runtime.dispose();
