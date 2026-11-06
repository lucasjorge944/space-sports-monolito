/** RN-BOOK-05: o jogador cancela até `cancellableUntil`; depois, "fale com o espaço". */
export function canCancelNow(cancellableUntil: string, now: Date = new Date()): boolean {
  return now.getTime() <= new Date(cancellableUntil).getTime();
}
