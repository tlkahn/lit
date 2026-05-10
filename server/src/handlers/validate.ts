import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { HandlerDeps } from "../types.js";

export async function handleValidate(
  deps: HandlerDeps,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const licenseId = event.queryStringParameters?.license_id;
  if (!licenseId) {
    return { statusCode: 400, body: "Missing license_id parameter" };
  }

  const record = await deps.db.getByLicenseId(licenseId);

  if (record?.status === "revoked") {
    return {
      statusCode: 200,
      body: JSON.stringify({ status: "revoked", reason: record.revoked_reason }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ status: "valid" }),
  };
}
