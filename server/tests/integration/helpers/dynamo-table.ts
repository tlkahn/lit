import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const ENDPOINT = "http://localhost:8000";

export function createTestDocClient(): {
  docClient: DynamoDBDocumentClient;
  rawClient: DynamoDBClient;
} {
  const rawClient = new DynamoDBClient({
    endpoint: ENDPOINT,
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const docClient = DynamoDBDocumentClient.from(rawClient);
  return { docClient, rawClient };
}

export async function createTestTable(
  rawClient: DynamoDBClient,
  tableName: string,
): Promise<void> {
  await rawClient.send(
    new CreateTableCommand({
      TableName: tableName,
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
}

export async function deleteTestTable(
  rawClient: DynamoDBClient,
  tableName: string,
): Promise<void> {
  await rawClient.send(new DeleteTableCommand({ TableName: tableName }));
}
