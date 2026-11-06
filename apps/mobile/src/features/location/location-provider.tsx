import * as Location from 'expo-location';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { type Coords, coarsen } from './coords';

/**
 * - `unknown`: ainda lendo o estado da permissão;
 * - `undetermined`: nunca perguntamos (ou o sistema ainda pode perguntar);
 * - `granted` / `denied`: resposta da pessoa (`denied` pode ser definitivo: só nas Configurações).
 */
export type LocationPermission = 'unknown' | 'undetermined' | 'granted' | 'denied';

interface LocationContextValue {
  permission: LocationPermission;
  /** Posição aproximada (~1 km); `null` sem permissão ou enquanto o GPS responde. */
  coords: Coords | null;
  /** O sistema ainda aceita abrir o pedido de permissão (senão, só pelas Configurações). */
  canAskAgain: boolean;
  /** Pede a permissão (se der) e carrega a posição. Devolve o estado final. */
  request: () => Promise<LocationPermission>;
}

const LocationContext = createContext<LocationContextValue | null>(null);

function toPermission(status: Location.PermissionStatus): LocationPermission {
  if (status === Location.PermissionStatus.GRANTED) return 'granted';
  if (status === Location.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

async function readCoords(): Promise<Coords | null> {
  try {
    // A última posição conhecida responde na hora; o GPS fresco só se não houver nenhuma.
    const last = await Location.getLastKnownPositionAsync();
    const position =
      last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return coarsen({ lat: position.coords.latitude, lng: position.coords.longitude });
  } catch {
    // Localização desligada no aparelho ou sem sinal: a vitrine funciona sem distância.
    return null;
  }
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [coords, setCoords] = useState<Coords | null>(null);

  const apply = useCallback(async (response: Location.LocationPermissionResponse) => {
    const next = toPermission(response.status);
    setPermission(next);
    setCanAskAgain(response.canAskAgain);
    if (next === 'granted') setCoords(await readCoords());
    else setCoords(null);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    void Location.getForegroundPermissionsAsync().then((response) => {
      if (active) void apply(response);
    });
    return () => {
      active = false;
    };
  }, [apply]);

  const request = useCallback(
    async () => apply(await Location.requestForegroundPermissionsAsync()),
    [apply],
  );

  const value = useMemo(
    () => ({ permission, coords, canAskAgain, request }),
    [permission, coords, canAskAgain, request],
  );
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const value = useContext(LocationContext);
  if (!value) throw new Error('useLocation precisa estar dentro de <LocationProvider>');
  return value;
}
