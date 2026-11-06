/** Trecho estável para `testID` a partir de um nome: "Quadra Coberta 1" → "quadra-coberta-1". */
export function testIdPart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
