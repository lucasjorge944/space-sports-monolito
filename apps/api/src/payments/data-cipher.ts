import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Cifra dos dados sensíveis do pagamento online na aplicação (decisão 97): AES-256-GCM com a chave
// de PAYMENTS_DATA_KEY (32 bytes em base64). Formato gravado: `v1.<iv>.<tag>.<cifrado>` (base64url),
// com o contexto (ex.: o id do espaço) como dado autenticado: o texto copiado para outra linha não
// decifra.

const VERSION = 'v1';

/** Token de injeção do cifrador dos dados do pagamento online. */
export const PAYMENTS_DATA_CIPHER = Symbol('PAYMENTS_DATA_CIPHER');

export class DataCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('PAYMENTS_DATA_KEY precisa de 32 bytes (base64).');
  }

  encrypt(plain: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, encrypted]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** Nulo se não decifrar (outra chave, contexto diferente ou texto adulterado). */
  decrypt(token: string, context: string): string | null {
    const [version, iv, tag, encrypted] = token.split('.');
    if (version !== VERSION || !iv || !tag || encrypted === undefined) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }
}
