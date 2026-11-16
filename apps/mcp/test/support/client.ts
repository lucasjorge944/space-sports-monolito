import {
  type CallToolResult,
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

/** Chama uma tool e devolve o resultado com os dados estruturados e todo o texto. */
export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
  // biome-ignore lint/suspicious/noExplicitAny: dados estruturados livres nos testes.
  const data = (result.structuredContent ?? {}) as any;
  return { result, data, text, isError: result.isError === true };
}

/** Cliente MCP do SDK (era 2025, como o padrão do SDK) por HTTP, com o Bearer informado. */
export async function connectClient(url: string, bearer: string): Promise<Client> {
  const client = new Client({ name: 'cliente-de-teste', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    }),
  );
  return client;
}
