import { handleMcpPost, mcpGetResponse } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A broad query over a busy clinic's ledger is the slow case, and it is still seconds. */
export const maxDuration = 60;

/**
 * The MCP endpoint, with the key in an `Authorization: Bearer` header.
 *
 * This is the form to prefer: a header is not written into server logs or browser history the way
 * a URL is. Claude Desktop, Claude Code and most programmatic clients send one. The sibling route
 * `/api/mcp/[key]` exists for the clients that cannot.
 */
export async function POST(request: Request) {
  return handleMcpPost(request);
}

export function GET() {
  return mcpGetResponse();
}
