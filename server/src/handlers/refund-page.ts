import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { refundPageHtml } from "../html/refund.js";

export async function handleRefundPage(
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: refundPageHtml(),
  };
}
