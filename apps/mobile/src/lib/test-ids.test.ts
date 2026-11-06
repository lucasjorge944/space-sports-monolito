import { testIdPart } from './test-ids';

describe('testIdPart', () => {
  it('remove acentos, caixa e pontuação', () => {
    expect(testIdPart('Quadra A')).toBe('quadra-a');
    expect(testIdPart('Ginásio Coberto · 2')).toBe('ginasio-coberto-2');
  });

  it('não deixa hífens nas pontas', () => {
    expect(testIdPart('  Arena E2E! ')).toBe('arena-e2e');
  });
});
