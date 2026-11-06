export interface Coords {
  lat: number;
  lng: number;
}

/**
 * Arredonda para ~1 km (2 casas). A vitrine ordena por distância e filtra por raio de vários
 * km, então não precisa da posição exata: isso estabiliza a chave de cache (o GPS oscila) e
 * evita mandar o ponto preciso da pessoa para o servidor.
 */
export function coarsen(coords: Coords): Coords {
  return { lat: Math.round(coords.lat * 100) / 100, lng: Math.round(coords.lng * 100) / 100 };
}
