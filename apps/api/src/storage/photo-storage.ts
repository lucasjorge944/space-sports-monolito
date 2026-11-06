export type StoredObject = { size: number; contentType: string | null };

export type PresignedUpload = {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
};

/**
 * Armazenamento das fotos (galeria e logo dos espaços, foto de perfil dos usuários). Classe
 * abstrata para servir de token de injeção (e de fake nos testes). O arquivo vai direto do cliente
 * para o storage por URL pré-assinada; a API só assina, confere o objeto e guarda a URL pública.
 * Implementação: `S3PhotoStorage` (Amazon S3 com CloudFront, decisão 72).
 */
export abstract class PhotoStorage {
  /** `false` quando o bucket não está no env (upload indisponível). */
  abstract readonly enabled: boolean;
  abstract presignUpload(key: string, contentType: string): Promise<PresignedUpload>;
  /** Metadados do objeto (`null` se não existe). */
  abstract head(key: string): Promise<StoredObject | null>;
  /**
   * Conteúdo do objeto (`null` se não existe), lido até `maxBytes + 1` bytes: um resultado maior
   * que `maxBytes` indica arquivo grande demais, sem trazer o resto para a memória.
   */
  abstract read(key: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Cópia no próprio storage (`false` se a origem não existe); a cópia mantém o Content-Type. */
  abstract copy(sourceKey: string, targetKey: string): Promise<boolean>;
  /** Apaga o objeto; falha só é logada (sobra um arquivo órfão, nunca um erro para quem chama). */
  abstract delete(key: string): Promise<void>;
  /**
   * Apaga todos os objetos sob o prefixo (lista e apaga em lote) e devolve quantos saíram. Para a
   * exclusão de conta: alcança também os órfãos. Falha só é logada, como no `delete`.
   */
  abstract deletePrefix(prefix: string): Promise<number>;
  abstract publicUrl(key: string): string;
  /** Chave do objeto a partir da URL pública (`null` se a URL não for deste storage). */
  abstract keyFromUrl(url: string): string | null;
}

/**
 * Validade das URLs de upload. No staging, as credenciais do papel de mídia valem 1 hora e o SDK só
 * as relê a 5 minutos de expirar: uma URL mais longa poderia vencer antes do `expiresAt`.
 */
export const UPLOAD_EXPIRES_SECONDS = 5 * 60;

/** Sem bucket no env: o upload responde 503. */
export class DisabledPhotoStorage extends PhotoStorage {
  readonly enabled = false;
  private fail(): never {
    throw new Error('Storage de fotos não configurado.');
  }
  presignUpload(): Promise<PresignedUpload> {
    this.fail();
  }
  head(): Promise<StoredObject | null> {
    this.fail();
  }
  read(): Promise<Uint8Array | null> {
    this.fail();
  }
  copy(): Promise<boolean> {
    this.fail();
  }
  async delete(): Promise<void> {}
  async deletePrefix(): Promise<number> {
    return 0;
  }
  publicUrl(): string {
    this.fail();
  }
  keyFromUrl(): string | null {
    return null;
  }
}
