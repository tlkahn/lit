import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { recoverPageHtml } from "../html/recover.js";

export async function handleRecoverPage(
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: recoverPageHtml(),
  };
}

export const handler = handleRecoverPage;
