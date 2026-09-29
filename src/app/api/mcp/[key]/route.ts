import { handleMcpPost, mcpGetResponse } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The same MCP endpoint, with the key in the address instead of a header.
 *
 * This exists because of a limitation on the other side rather than a preference on ours:
 * claude.ai's "Add custom connector" dialog accepts a URL and OAuth credentials, and nothing
 * else. A static header can be configured, but only as an organisation-level setting, which a
 * personal account does not have — so for the people this feature was built for, a key in the
 * URL is the only thing that works. Most public MCP servers offer the same fallback for the same
 * reason.
 *
 * The cost is real and worth stating plainly: a key in a URL is written into server access logs,
 * proxy logs and browser history, where a header is not. It is still a single-clinic credential
 * that the owner can revoke from Settings in one click, which is the mitigation that matters —
 * but the header form is the better one wherever the client supports it.
 */
export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  return handleMcpPost(request, key);
}

export function GET() {
  return mcpGetResponse();
}
