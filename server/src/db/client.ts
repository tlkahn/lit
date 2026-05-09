import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export function createDocClient(
  endpoint?: string,
): DynamoDBDocumentClient {
  const base = new DynamoDBClient(endpoint ? { endpoint } : {});
  return DynamoDBDocumentClient.from(base);
}
