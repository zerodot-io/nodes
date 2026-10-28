// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BSON } from "mongodb";
import { credentialTypes, nodes } from "./index";
import { type MongoCollection, mongoSettings, runMongoOperation } from "./mongodb";

const node = nodes.find((entry) => entry.type === "mongodb.documents");

describe("mongoSettings", () => {
  it("reads the connection string and the database", () => {
    const data = { connectionString: "mongodb://h", database: "d" };
    assert.deepEqual(mongoSettings({ type: "mongodb", data }), data);
  });

  it("needs the right credential with both fields", () => {
    assert.throws(() => mongoSettings(null), /Pick a MongoDB credential/);
    assert.throws(
      () => mongoSettings({ type: "mongodb", data: { database: "d" } }),
      /connectionString/,
    );
    assert.throws(
      () => mongoSettings({ type: "mongodb", data: { connectionString: "mongodb://h" } }),
      /database/,
    );
  });
});

describe("MongoDB operations", () => {
  const bson = BSON as unknown as Parameters<typeof runMongoOperation>[0];
  const id = new BSON.ObjectId("65f0c0c0c0c0c0c0c0c0c0c0");
  const seen: unknown[] = [];
  const collection = {
    find: (query: object, options: object) => {
      seen.push(["find", query, options]);
      return { toArray: async () => [{ _id: id, at: new Date("2026-10-26T00:00:00Z"), n: 1 }] };
    },
    insertMany: async (documents: object[]) => {
      seen.push(["insert", documents]);
      return { insertedIds: { 0: id } };
    },
    updateMany: async (query: object, update: object, options: object) => {
      seen.push(["update", query, update, options]);
      return { matchedCount: 2, modifiedCount: 1 };
    },
    deleteMany: async (query: object) => {
      seen.push(["delete", query]);
      return { deletedCount: 4 };
    },
    aggregate: (pipeline: object[]) => {
      seen.push(["aggregate", pipeline]);
      return { toArray: async () => [{ total: 3 }] };
    },
    findOneAndUpdate: async () => ({ _id: id }),
    findOneAndReplace: async () => null,
  } as unknown as MongoCollection;
  const base = {
    operation: "find",
    collection: "c",
    query: "{}",
    sort: "",
    projection: "",
    limit: 0,
    skip: 0,
    documents: "[]",
    update: "",
    replacement: "",
    upsert: false,
    pipeline: "[]",
  } as const;

  it("finds documents and gives plain JSON", async () => {
    const out = await runMongoOperation(bson, collection, {
      ...base,
      query: '{"_id": {"$oid": "65f0c0c0c0c0c0c0c0c0c0c0"}}',
      sort: '{"n": -1}',
      limit: 5,
    });
    assert.deepEqual(out, {
      items: [{ _id: "65f0c0c0c0c0c0c0c0c0c0c0", at: "2026-10-26T00:00:00Z", n: 1 }],
    });
    const [, query, options] = seen[0] as [string, { _id: unknown }, object];
    assert.ok(query._id instanceof BSON.ObjectId);
    assert.deepEqual(options, {
      sort: { n: -1 },
      projection: undefined,
      limit: 5,
      skip: undefined,
    });
  });

  it("inserts, updates, deletes, and aggregates", async () => {
    assert.deepEqual(
      await runMongoOperation(bson, collection, {
        ...base,
        operation: "insert",
        documents: '{"a": 1}',
      }),
      { insertedCount: 1, insertedIds: { 0: "65f0c0c0c0c0c0c0c0c0c0c0" } },
    );
    assert.deepEqual(
      await runMongoOperation(bson, collection, {
        ...base,
        operation: "update",
        query: '{"a": 1}',
        update: '{"$set": {"a": 2}}',
        upsert: true,
      }),
      { matchedCount: 2, modifiedCount: 1, upsertedId: null },
    );
    assert.deepEqual(
      await runMongoOperation(bson, collection, {
        ...base,
        operation: "delete",
        query: '{"a": 1}',
      }),
      { deletedCount: 4 },
    );
    assert.deepEqual(
      await runMongoOperation(bson, collection, {
        ...base,
        operation: "aggregate",
        pipeline: '[{"$count": "total"}]',
      }),
      { items: [{ total: 3 }] },
    );
    assert.deepEqual(
      await runMongoOperation(bson, collection, {
        ...base,
        operation: "findOneAndUpdate",
        update: "{}",
      }),
      { document: { _id: "65f0c0c0c0c0c0c0c0c0c0c0" } },
    );
  });

  it("names the field that is not valid", async () => {
    await assert.rejects(
      runMongoOperation(bson, collection, { ...base, query: "{oops" }),
      /Query is not valid JSON/,
    );
    await assert.rejects(
      runMongoOperation(bson, collection, { ...base, query: "[1]" }),
      /Query must be a JSON object/,
    );
    await assert.rejects(
      runMongoOperation(bson, collection, { ...base, operation: "insert", documents: "[1]" }),
      /Documents must hold JSON objects/,
    );
  });
});

describe("mongodb node and credential", () => {
  it("has its operations", () => {
    assert.ok(node);
    assert.equal(node.credentialTypes?.[0], "mongodb");
    assert.equal(node.actions?.length, 7);
    assert.equal(node.config.safeParse({ operation: "x" }).success, false);
  });

  it("checks the credential data", () => {
    const fields = credentialTypes[0]?.fields.strict();
    assert.ok(fields);
    assert.equal(
      fields.safeParse({ connectionString: "mongodb+srv://h", database: "d" }).success,
      true,
    );
    assert.equal(fields.safeParse({ connectionString: "http://h", database: "d" }).success, false);
    assert.equal(fields.safeParse({ connectionString: "mongodb://h" }).success, false);
  });
});
