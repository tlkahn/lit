import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { DbOps, LicenseRecord } from "../types.js";
import { IdempotencyError, LicenseNotFoundError } from "./errors.js";

export async function createLicense(
  client: DynamoDBDocumentClient,
  table: string,
  record: LicenseRecord,
): Promise<LicenseRecord> {
  try {
    await client.send(
      new PutCommand({
        TableName: table,
        Item: record,
        ConditionExpression: "attribute_not_exists(license_id)",
      }),
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
      throw new IdempotencyError();
    }
    throw err;
  }
  return record;
}

export async function getBySessionId(
  client: DynamoDBDocumentClient,
  table: string,
  sessionId: string,
): Promise<LicenseRecord | null> {
  const result = await client.send(
    new QueryCommand({
      TableName: table,
      IndexName: "stripe_session_id-index",
      KeyConditionExpression: "stripe_session_id = :sid",
      ExpressionAttributeValues: { ":sid": sessionId },
    }),
  );
  if (!result.Items?.length) return null;
  return result.Items[0] as LicenseRecord;
}

export async function getByChargeId(
  client: DynamoDBDocumentClient,
  table: string,
  chargeId: string,
): Promise<LicenseRecord | null> {
  const result = await client.send(
    new QueryCommand({
      TableName: table,
      IndexName: "stripe_charge_id-index",
      KeyConditionExpression: "stripe_charge_id = :cid",
      ExpressionAttributeValues: { ":cid": chargeId },
    }),
  );
  if (!result.Items?.length) return null;
  return result.Items[0] as LicenseRecord;
}

export async function getByLicenseId(
  client: DynamoDBDocumentClient,
  table: string,
  licenseId: string,
): Promise<LicenseRecord | null> {
  const result = await client.send(
    new GetCommand({
      TableName: table,
      Key: { license_id: licenseId },
    }),
  );
  if (!result.Item) return null;
  return result.Item as LicenseRecord;
}

export async function getByEmailHash(
  client: DynamoDBDocumentClient,
  table: string,
  emailHash: string,
): Promise<LicenseRecord[]> {
  const result = await client.send(
    new QueryCommand({
      TableName: table,
      IndexName: "email_hash-index",
      KeyConditionExpression: "email_hash = :eh",
      ExpressionAttributeValues: { ":eh": emailHash },
    }),
  );
  return (result.Items ?? []) as LicenseRecord[];
}

export async function revokeLicense(
  client: DynamoDBDocumentClient,
  table: string,
  licenseId: string,
  reason: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    await client.send(
      new UpdateCommand({
        TableName: table,
        Key: { license_id: licenseId },
        UpdateExpression:
          "SET #status = :s, revoked_at = :ra, revoked_reason = :rr, updated_at = :ua",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":s": "revoked",
          ":ra": now,
          ":rr": reason,
          ":ua": now,
        },
        ConditionExpression: "attribute_exists(license_id)",
      }),
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
      throw new LicenseNotFoundError();
    }
    throw err;
  }
}

export function createDbOps(
  client: DynamoDBDocumentClient,
  table: string,
): DbOps {
  return {
    createLicense: (record) => createLicense(client, table, record),
    getBySessionId: (sessionId) => getBySessionId(client, table, sessionId),
    getByChargeId: (chargeId) => getByChargeId(client, table, chargeId),
    getByLicenseId: (licenseId) => getByLicenseId(client, table, licenseId),
    getByEmailHash: (emailHash) => getByEmailHash(client, table, emailHash),
    revokeLicense: (licenseId, reason) =>
      revokeLicense(client, table, licenseId, reason),
  };
}
