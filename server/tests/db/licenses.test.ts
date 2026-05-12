import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { LicenseRecord } from "../../src/types.js";
import { IdempotencyError, LicenseNotFoundError } from "../../src/db/errors.js";
import {
  createLicense,
  getBySessionId,
  getByChargeId,
  getByLicenseId,
  getByEmailHash,
  revokeLicense,
  createDbOps,
} from "../../src/db/licenses.js";

const TABLE = "licenses-test";

const mockSend = vi.fn();
const client = { send: mockSend } as unknown as DynamoDBDocumentClient;

function makeLicenseRecord(
  overrides?: Partial<LicenseRecord>,
): LicenseRecord {
  return {
    license_id: "LIT-2025-abc123",
    email_hash: "sha256hex",
    stripe_session_id: "cs_test_xxx",
    stripe_charge_id: "ch_test_yyy",
    status: "active",
    license_key_pem: "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
    issued_at: 1700000000,
    updated_at: 1700000000,
    ...overrides,
  };
}

beforeEach(() => {
  mockSend.mockReset();
});

describe("createLicense", () => {
  it("sends PutCommand with condition to prevent duplicates", async () => {
    mockSend.mockResolvedValue({});
    const record = makeLicenseRecord();

    await createLicense(client, TABLE, record);

    expect(mockSend).toHaveBeenCalledOnce();
    const input = mockSend.mock.calls[0]![0].input;
    expect(input.TableName).toBe(TABLE);
    expect(input.Item).toEqual(record);
    expect(input.ConditionExpression).toBe(
      "attribute_not_exists(license_id)",
    );
  });

  it("returns the input record on success", async () => {
    mockSend.mockResolvedValue({});
    const record = makeLicenseRecord();

    const result = await createLicense(client, TABLE, record);

    expect(result).toEqual(record);
  });

  it("throws IdempotencyError on ConditionalCheckFailedException", async () => {
    const err = new Error("conditional");
    err.name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValue(err);

    await expect(
      createLicense(client, TABLE, makeLicenseRecord()),
    ).rejects.toThrow(IdempotencyError);
  });
});

describe("getBySessionId", () => {
  it("sends QueryCommand on stripe_session_id-index GSI", async () => {
    mockSend.mockResolvedValue({ Items: [makeLicenseRecord()] });

    await getBySessionId(client, TABLE, "cs_test_xxx");

    expect(mockSend).toHaveBeenCalledOnce();
    const input = mockSend.mock.calls[0]![0].input;
    expect(input.TableName).toBe(TABLE);
    expect(input.IndexName).toBe("stripe_session_id-index");
    expect(input.KeyConditionExpression).toBe(
      "stripe_session_id = :sid",
    );
    expect(input.ExpressionAttributeValues).toEqual({
      ":sid": "cs_test_xxx",
    });
  });

  it("returns null when Items is empty", async () => {
    mockSend.mockResolvedValue({ Items: [] });

    const result = await getBySessionId(client, TABLE, "cs_test_xxx");

    expect(result).toBeNull();
  });

  it("returns null when Items is undefined", async () => {
    mockSend.mockResolvedValue({});

    const result = await getBySessionId(client, TABLE, "cs_test_xxx");

    expect(result).toBeNull();
  });
});

describe("getByChargeId", () => {
  it("sends QueryCommand on stripe_charge_id-index GSI", async () => {
    mockSend.mockResolvedValue({ Items: [makeLicenseRecord()] });

    await getByChargeId(client, TABLE, "ch_test_yyy");

    expect(mockSend).toHaveBeenCalledOnce();
    const input = mockSend.mock.calls[0]![0].input;
    expect(input.TableName).toBe(TABLE);
    expect(input.IndexName).toBe("stripe_charge_id-index");
    expect(input.KeyConditionExpression).toBe(
      "stripe_charge_id = :cid",
    );
    expect(input.ExpressionAttributeValues).toEqual({
      ":cid": "ch_test_yyy",
    });
  });

  it("returns null when no items", async () => {
    mockSend.mockResolvedValue({ Items: [] });

    const result = await getByChargeId(client, TABLE, "ch_test_yyy");

    expect(result).toBeNull();
  });
});

describe("makeLicenseRecord optional fields", () => {
  it("stripe_charge_id is present by default", () => {
    const record = makeLicenseRecord();
    expect(record.stripe_charge_id).toBe("ch_test_yyy");
  });

  it("stripe_charge_id can be explicitly set to undefined", () => {
    const record = makeLicenseRecord({ stripe_charge_id: undefined });
    expect(record.stripe_charge_id).toBeUndefined();
  });
});

describe("getByLicenseId", () => {
  it("sends GetCommand with license_id key", async () => {
    mockSend.mockResolvedValue({ Item: makeLicenseRecord() });

    await getByLicenseId(client, TABLE, "LIT-2025-abc123");

    expect(mockSend).toHaveBeenCalledOnce();
    const input = mockSend.mock.calls[0]![0].input;
    expect(input.TableName).toBe(TABLE);
    expect(input.Key).toEqual({ license_id: "LIT-2025-abc123" });
  });

  it("returns null when Item is undefined", async () => {
    mockSend.mockResolvedValue({});

    const result = await getByLicenseId(client, TABLE, "LIT-2025-abc123");

    expect(result).toBeNull();
  });
});

describe("getByEmailHash", () => {
  it("queries email_hash-index and returns all items", async () => {
    const records = [
      makeLicenseRecord({ license_id: "LIT-2025-aaa" }),
      makeLicenseRecord({ license_id: "LIT-2025-bbb" }),
    ];
    mockSend.mockResolvedValue({ Items: records });

    const result = await getByEmailHash(client, TABLE, "sha256hex");

    expect(mockSend).toHaveBeenCalledOnce();
    const input = mockSend.mock.calls[0]![0].input;
    expect(input.TableName).toBe(TABLE);
    expect(input.IndexName).toBe("email_hash-index");
    expect(input.KeyConditionExpression).toBe("email_hash = :eh");
    expect(input.ExpressionAttributeValues).toEqual({
      ":eh": "sha256hex",
    });
    expect(result).toEqual(records);
  });

  it("returns empty array when Items is undefined", async () => {
    mockSend.mockResolvedValue({});

    const result = await getByEmailHash(client, TABLE, "sha256hex");

    expect(result).toEqual([]);
  });
});

describe("revokeLicense", () => {
  it("sends UpdateCommand setting status, revoked_at, revoked_reason, updated_at", async () => {
    mockSend.mockResolvedValue({});

    await revokeLicense(client, TABLE, "LIT-2025-abc123", "refunded");

    expect(mockSend).toHaveBeenCalledOnce();
    const input = mockSend.mock.calls[0]![0].input;
    expect(input.TableName).toBe(TABLE);
    expect(input.Key).toEqual({ license_id: "LIT-2025-abc123" });
    expect(input.UpdateExpression).toBe(
      "SET #status = :s, revoked_at = :ra, revoked_reason = :rr, updated_at = :ua",
    );
    expect(input.ExpressionAttributeNames).toEqual({ "#status": "status" });
    expect(input.ExpressionAttributeValues).toEqual({
      ":s": "revoked",
      ":ra": expect.any(Number),
      ":rr": "refunded",
      ":ua": expect.any(Number),
    });
    expect(input.ConditionExpression).toBe("attribute_exists(license_id)");
  });

  it("throws LicenseNotFoundError on ConditionalCheckFailedException", async () => {
    const err = new Error("conditional");
    err.name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValue(err);

    await expect(
      revokeLicense(client, TABLE, "nonexistent-id", "test"),
    ).rejects.toThrow(LicenseNotFoundError);
  });
});

describe("createDbOps", () => {
  it("returns an object satisfying the DbOps interface", () => {
    const ops = createDbOps(client, TABLE);

    expect(ops.createLicense).toBeTypeOf("function");
    expect(ops.getBySessionId).toBeTypeOf("function");
    expect(ops.getByChargeId).toBeTypeOf("function");
    expect(ops.getByLicenseId).toBeTypeOf("function");
    expect(ops.getByEmailHash).toBeTypeOf("function");
    expect(ops.revokeLicense).toBeTypeOf("function");
  });
});
