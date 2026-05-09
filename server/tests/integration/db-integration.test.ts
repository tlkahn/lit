import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { LicenseRecord } from "../../src/types.js";
import { IdempotencyError, LicenseNotFoundError } from "../../src/db/errors.js";
import {
  createLicense,
  getBySessionId,
  getByChargeId,
  getByLicenseId,
  getByEmailHash,
  revokeLicense,
} from "../../src/db/licenses.js";

const TABLE = "licenses-integration-test";
const ENDPOINT = "http://localhost:8000";

let client: DynamoDBDocumentClient;
let rawClient: DynamoDBClient;

let counter = 0;
function makeLicenseRecord(
  overrides?: Partial<LicenseRecord>,
): LicenseRecord {
  counter++;
  return {
    license_id: `LIT-2025-int${counter}`,
    email_hash: `hash-${counter}`,
    stripe_session_id: `cs_int_${counter}`,
    stripe_charge_id: `ch_int_${counter}`,
    status: "active",
    license_key_pem: "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
    issued_at: 1700000000,
    updated_at: 1700000000,
    ...overrides,
  };
}

beforeAll(async () => {
  rawClient = new DynamoDBClient({
    endpoint: ENDPOINT,
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  client = DynamoDBDocumentClient.from(rawClient);

  await rawClient.send(
    new CreateTableCommand({
      TableName: TABLE,
      KeySchema: [{ AttributeName: "license_id", KeyType: "HASH" }],
      AttributeDefinitions: [
        { AttributeName: "license_id", AttributeType: "S" },
        { AttributeName: "stripe_session_id", AttributeType: "S" },
        { AttributeName: "stripe_charge_id", AttributeType: "S" },
        { AttributeName: "email_hash", AttributeType: "S" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "stripe_session_id-index",
          KeySchema: [
            { AttributeName: "stripe_session_id", KeyType: "HASH" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
        {
          IndexName: "stripe_charge_id-index",
          KeySchema: [
            { AttributeName: "stripe_charge_id", KeyType: "HASH" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
        {
          IndexName: "email_hash-index",
          KeySchema: [
            { AttributeName: "email_hash", KeyType: "HASH" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
});

afterAll(async () => {
  await rawClient.send(
    new DeleteTableCommand({ TableName: TABLE }),
  );
  rawClient.destroy();
});

describe("DynamoDB integration", () => {
  it("create + getByLicenseId round-trip", async () => {
    const record = makeLicenseRecord();
    const created = await createLicense(client, TABLE, record);
    expect(created).toEqual(record);

    const fetched = await getByLicenseId(client, TABLE, record.license_id);
    expect(fetched).toEqual(record);
  });

  it("duplicate license_id throws IdempotencyError", async () => {
    const record = makeLicenseRecord();
    await createLicense(client, TABLE, record);

    await expect(
      createLicense(client, TABLE, record),
    ).rejects.toThrow(IdempotencyError);
  });

  it("getBySessionId returns correct license", async () => {
    const record = makeLicenseRecord();
    await createLicense(client, TABLE, record);

    const fetched = await getBySessionId(
      client,
      TABLE,
      record.stripe_session_id,
    );
    expect(fetched).toEqual(record);
  });

  it("getByChargeId returns correct license", async () => {
    const record = makeLicenseRecord();
    await createLicense(client, TABLE, record);

    const fetched = await getByChargeId(
      client,
      TABLE,
      record.stripe_charge_id,
    );
    expect(fetched).toEqual(record);
  });

  it("getByEmailHash returns matches", async () => {
    const sharedHash = `shared-hash-${counter}`;
    const r1 = makeLicenseRecord({ email_hash: sharedHash });
    const r2 = makeLicenseRecord({ email_hash: sharedHash });
    await createLicense(client, TABLE, r1);
    await createLicense(client, TABLE, r2);

    const results = await getByEmailHash(client, TABLE, sharedHash);
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.license_id).sort();
    expect(ids).toEqual([r1.license_id, r2.license_id].sort());
  });

  it("revoking non-existent license throws LicenseNotFoundError", async () => {
    await expect(
      revokeLicense(client, TABLE, "nonexistent-id", "test"),
    ).rejects.toThrow(LicenseNotFoundError);
  });

  it("revoke then get shows revoked status", async () => {
    const record = makeLicenseRecord();
    await createLicense(client, TABLE, record);

    await revokeLicense(client, TABLE, record.license_id, "refunded");

    const fetched = await getByLicenseId(client, TABLE, record.license_id);
    expect(fetched!.status).toBe("revoked");
    expect(fetched!.revoked_reason).toBe("refunded");
    expect(fetched!.revoked_at).toEqual(expect.any(Number));
  });
});
