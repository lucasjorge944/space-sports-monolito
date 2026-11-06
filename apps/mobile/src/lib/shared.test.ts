import { formatCents } from '@space-sports/shared';

it('resolve @space-sports/shared e formata centavos em BRL', () => {
  expect(formatCents(15000).replace(/\s/g, ' ')).toBe('R$ 150,00');
});
