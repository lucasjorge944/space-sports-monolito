/** Célula CSV: aspas quando há separador, aspas ou quebra de linha; neutraliza fórmulas do Excel. */
function cell(value: string | number): string {
  let text = String(value);
  // Valores que começam com =, +, -, @, tab ou CR viram fórmula no Excel/Sheets (CSV injection).
  if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV para o Excel em português: separador `;`, quebra CRLF e BOM UTF-8. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const lines = [header, ...rows].map((r) => r.map(cell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
