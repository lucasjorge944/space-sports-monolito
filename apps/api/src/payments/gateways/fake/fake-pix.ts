import qrcode from 'qrcode-generator';

// Pix de mentira do gateway fake (docs/13 §10): um "copia e cola" no formato do BR Code (EMV, com
// CRC16) e o QR em SVG, gerados localmente. A chave e o recebedor deixam claro que é teste.

const field = (id: string, value: string) =>
  `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), como exige o BR Code. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** BR Code estático de teste com o valor e o identificador da cobrança. */
export function fakePixCopyPaste(amountCents: number, txid: string): string {
  const account = field('00', 'br.gov.bcb.pix') + field('01', 'pix-teste@spacesports.invalid');
  const amount = (amountCents / 100).toFixed(2);
  const payload =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    field('54', amount) +
    field('58', 'BR') +
    field('59', 'SPACE SPORTS TESTE') +
    field('60', 'TESTE') +
    field('62', field('05', txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25))) +
    '6304';
  return payload + crc16(payload);
}

/**
 * QR Code em SVG, com a margem de 4 módulos. Os módulos usam `currentColor` e não há fundo fixo:
 * a tela define as cores pelos tokens (a leitura pede módulos escuros sobre fundo claro).
 */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  const margin = 4;
  const total = size + margin * 2;
  let path = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><path d="${path}" fill="currentColor"/></svg>`;
}
