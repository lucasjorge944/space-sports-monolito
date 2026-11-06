import { test as base } from '@playwright/test';

export { expect, type Page } from '@playwright/test';

/**
 * `test` com a API simulada isolada por teste: cada teste ganha um escopo próprio (cookie no browser,
 * header no `request`), e a API simulada guarda por escopo o registro de chamadas (`/__calls`) e o
 * `logoUrl` do espaço A. Sem isso, o `/__reset` e as leituras de `mockCalls` de um teste atrapalham
 * os que rodam em paralelo. Specs que leem `mockCalls` ou chamam `/__reset` importam daqui.
 */
export const test = base.extend<{ scope: string }>({
  scope: [
    async ({ browserName }, use, testInfo) => {
      await use(`${browserName}-${testInfo.testId}-${testInfo.retry}`);
    },
    { auto: true },
  ],
  context: async ({ context, scope }, use) => {
    await context.addCookies([{ name: 'e2e-scope', value: scope, url: 'http://localhost:3100' }]);
    await use(context);
  },
  request: async ({ playwright, scope }, use) => {
    const request = await playwright.request.newContext({
      extraHTTPHeaders: { 'x-e2e-scope': scope },
    });
    await use(request);
    await request.dispose();
  },
});
