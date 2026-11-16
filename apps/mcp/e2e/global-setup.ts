import { connect } from 'node:net';
import type { TestProject } from 'vitest/node';
import { REDIS_URL } from './support/env.js';
import { type Running, startApi, startMcp } from './support/processes.js';
import { buildWorld } from './support/world.js';

const running: Running[] = [];

/**
 * Sobe a API e o apps/mcp REAIS (builds de produção, em processos próprios) sobre o Postgres e o
 * Redis dos contêineres do e2e (e2e/run.sh). Com MCP_E2E_EXTERNAL=1 não sobe nada: usa o que já
 * estiver escutando nas portas (útil para depurar com os servidores em outro terminal).
 */
/** Zera os contadores de limite (por usuário) do Redis do e2e: só em Redis local. */
async function flushRedis() {
  const url = new URL(REDIS_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Recuso limpar um Redis que não é local: ${url.hostname}`);
  }
  await new Promise<void>((resolve, reject) => {
    const socket = connect(Number(url.port || 6379), url.hostname, () =>
      socket.write('FLUSHALL\r\n'),
    );
    socket.once('data', (data) => {
      socket.end();
      if (String(data).startsWith('+OK')) resolve();
      else reject(new Error(`FLUSHALL: ${data}`));
    });
    socket.once('error', reject);
  });
}

export async function setup(project: TestProject) {
  await flushRedis();
  if (process.env.MCP_E2E_EXTERNAL !== '1') {
    running.push(await startApi());
    running.push(await startMcp());
  }
  // Mundo de dados da fase 2 (arquivos 11 a 17): cadastros pela API real, o resto direto no banco.
  project.provide('world', await buildWorld());
}

export async function teardown() {
  await Promise.all(running.map((proc) => proc.stop()));
}
