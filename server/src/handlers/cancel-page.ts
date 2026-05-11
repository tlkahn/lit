import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { cancelPageHtml } from "../html/cancel.js";

export async function handleCancelPage(
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: cancelPageHtml(),
  };
}

export const handler = handleCancelPage;
