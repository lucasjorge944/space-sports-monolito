/** Baixa um texto como arquivo no navegador (o conteúdo já veio da API pelo cliente gerado). */
export function downloadTextFile(filename: string, content: string, mime = 'text/csv') {
  // BOM para o Excel abrir acentos em UTF-8.
  const blob = new Blob(['﻿', content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
