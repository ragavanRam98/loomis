// Direct transport for the Stitch MCP HTTP endpoint (JSON-RPC tools/call).
// Loomis owns this client rather than depending on the host MCP client (which can get
// stuck in a stale-auth state). The API key is passed in by the caller; this module
// never reads env and never logs the key.

export class ProviderError extends Error {
  readonly code: string;
  constructor(message: string, code = 'PROVIDER_ERROR') {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

export interface McpTransportOptions {
  /** Injectable fetch for tests; defaults to the global fetch (undici on Node 18+). */
  fetchImpl?: typeof fetch;
  /** Override the endpoint (tests). */
  endpoint?: string;
}

interface McpResponse {
  error?: { message?: string };
  result?: { content?: Array<{ text?: string }>; structuredContent?: unknown; isError?: boolean };
}

export const STITCH_MCP_ENDPOINT = 'https://stitch.googleapis.com/mcp';

let rpcId = 0;

/** Call a provider MCP tool and return the unwrapped result (parsed from result.content[0].text). */
export async function mcpToolCall(
  apiKey: string,
  toolName: string,
  args: Record<string, unknown>,
  opts: McpTransportOptions = {},
): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? STITCH_MCP_ENDPOINT;
  rpcId += 1;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: rpcId,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });

  const res = await doFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-Goog-Api-Key': apiKey,
    },
    body,
  });

  if (!res.ok) {
    throw new ProviderError(`provider HTTP ${res.status} for ${toolName}`, 'PROVIDER_HTTP');
  }

  const json = (await res.json()) as McpResponse;
  if (json.error) {
    throw new ProviderError(
      `provider RPC error for ${toolName}: ${json.error.message ?? 'unknown'}`,
      'PROVIDER_RPC',
    );
  }

  const text = json.result?.content?.[0]?.text;
  // A tool that ran but failed says so in its result (MCP's isError), its message as the content. That is an
  // error, not an answer: taken as one, a caller polling for a field waits until it times out.
  if (json.result?.isError) {
    throw new ProviderError(
      `provider tool error for ${toolName}: ${typeof text === 'string' ? text : 'unknown'}`,
      'PROVIDER_TOOL_ERROR',
    );
  }
  if (typeof text === 'string') {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return json.result?.structuredContent ?? json.result ?? null;
}
