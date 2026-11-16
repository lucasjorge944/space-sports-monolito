import {
  type CallToolResult,
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { MCP_URL } from './env.js';

export type ToolResult = {
  result: CallToolResult;
  // biome-ignore lint/suspicious/noExplicitAny: dados estruturados livres das tools.
  data: any;
  text: string;
  isError: boolean;
  /** `error.code` estável das tools (ex.: `CONFIRMATION_INVALID`), quando há erro. */
  code: string | undefined;
};

/** Cliente MCP do SDK, por HTTP real, com o Bearer informado. */
export async function mcpClient(bearer: string, url = MCP_URL): Promise<Client> {
  const client = new Client({ name: 'qa-e2e', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    }),
  );
  return client;
}

export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
  const data = result.structuredContent ?? {};
  return {
    result,
    data,
    text,
    isError: result.isError === true,
    code: (data as { error?: { code?: string } }).error?.code,
  };
}

/** `call` que exige sucesso e devolve os dados. */
export async function ok(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await call(client, name, args);
  if (res.isError) throw new Error(`${name} falhou: ${res.text}`);
  return res.data;
}

/** JSON-RPC cru por HTTP (sem o SDK), para casos de token/cabeçalho que o SDK esconde. */
export async function rawMcp(
  headers: Record<string, string>,
  body: unknown = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  url = MCP_URL,
  method = 'POST',
) {
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}
