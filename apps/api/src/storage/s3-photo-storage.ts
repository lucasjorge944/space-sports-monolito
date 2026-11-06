import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger } from '@nestjs/common';
import type { Env } from '../config/env.js';
import {
  DisabledPhotoStorage,
  PhotoStorage,
  type PresignedUpload,
  type StoredObject,
  UPLOAD_EXPIRES_SECONDS,
} from './photo-storage.js';

/**
 * Amazon S3 com CloudFront na frente (decisão 72). O bucket é privado: o cliente envia o arquivo
 * pela URL pré-assinada (PUT) e as fotos publicadas são lidas pelo domínio do CloudFront
 * (`publicUrl`), que só alcança `spaces/` e `users/`.
 */
export class S3PhotoStorage extends PhotoStorage {
  readonly enabled = true;
  private readonly logger = new Logger(S3PhotoStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor(config: { client: S3Client; bucket: string; publicUrl: string }) {
    super();
    this.client = config.client;
    this.bucket = config.bucket;
    this.publicBase = config.publicUrl.replace(/\/+$/, '');
  }

  async presignUpload(key: string, contentType: string): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    // O Content-Type entra na assinatura: o cliente precisa enviá-lo igual ao pedido.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_EXPIRES_SECONDS,
      signableHeaders: new Set(['content-type']),
    });
    return {
      url,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + UPLOAD_EXPIRES_SECONDS * 1000),
    };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const output = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: output.ContentLength ?? 0, contentType: output.ContentType ?? null };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async read(key: string, maxBytes: number): Promise<Uint8Array | null> {
    let body: ReadableStream<Uint8Array> | undefined;
    try {
      // O Range limita o que o S3 envia mesmo que o objeto tenha sido regravado depois do HEAD.
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${maxBytes}` }),
      );
      body = output.Body?.transformToWebStream();
    } catch (err) {
      if (isNotFound(err)) return null;
      // Objeto vazio: nenhum byte satisfaz o Range.
      if (httpStatus(err) === 416) return new Uint8Array();
      throw err;
    }
    return body ? readUpTo(body, maxBytes + 1) : new Uint8Array();
  }

  async copy(sourceKey: string, targetKey: string): Promise<boolean> {
    try {
      // `COPY` (o padrão, explícito aqui) mantém os metadados da origem, inclusive o Content-Type.
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: targetKey,
          CopySource: `${this.bucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
          MetadataDirective: 'COPY',
        }),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      if (!isNotFound(err)) {
        this.logger.warn({ err, key }, 'Falha ao apagar o objeto no storage');
      }
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    try {
      let token: string | undefined;
      do {
        // Até 1.000 chaves por página, o mesmo limite do DeleteObjects.
        const page = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        );
        const keys = (page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : []));
        if (keys.length) {
          const result = await this.client.send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
            }),
          );
          const errors = result.Errors ?? [];
          deleted += keys.length - errors.length;
          if (errors.length) {
            this.logger.warn(
              { prefix, failed: errors.length, error: errors[0]?.Code },
              'Falha ao apagar parte dos objetos do prefixo no storage',
            );
          }
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    } catch (err) {
      this.logger.warn(
        { err, prefix, deleted },
        'Falha ao apagar os objetos do prefixo no storage',
      );
    }
    return deleted;
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${key}`;
  }

  keyFromUrl(url: string): string | null {
    const prefix = `${this.publicBase}/`;
    return url.startsWith(prefix) && url.length > prefix.length ? url.slice(prefix.length) : null;
  }
}

type SdkError = { name?: unknown; $metadata?: { httpStatusCode?: number } };

const httpStatus = (err: unknown) => (err as SdkError | null)?.$metadata?.httpStatusCode;

/** Objeto inexistente: `NoSuchKey` (GET, cópia) ou `NotFound` (HEAD, sem corpo na resposta). */
function isNotFound(err: unknown): boolean {
  const name = (err as SdkError | null)?.name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

/** Lê o corpo até `limit` bytes e cancela o resto (caso o storage ignore o Range). */
export async function readUpTo(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    // Sem ler até o fim, o socket só volta ao pool se o corpo for cancelado.
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

/** Variáveis do storage (também lidas pelo seed de demonstração, fora da app Nest). */
export type PhotoStorageEnv = Pick<
  Env,
  | 'S3_BUCKET'
  | 'S3_PUBLIC_URL'
  | 'S3_REGION'
  | 'S3_ENDPOINT'
  | 'S3_FORCE_PATH_STYLE'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY'
>;

/**
 * Cliente do SDK. Sem chaves no env, vale a cadeia padrão do SDK: no staging, o `AWS_CONFIG_FILE`
 * com o `credential_process` do papel de mídia, que o host renova (infra/README.md).
 */
export function createS3Client(
  env: Omit<PhotoStorageEnv, 'S3_BUCKET' | 'S3_PUBLIC_URL'>,
): S3Client {
  const config: S3ClientConfig = {
    region: env.S3_REGION,
    // Sem isto, a URL pré-assinada do PUT leva o checksum do corpo vazio (x-amz-checksum-crc32) e
    // o upload do arquivo de verdade falha; o MinIO também não exige o checksum.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
  if (env.S3_ENDPOINT) config.endpoint = env.S3_ENDPOINT;
  if (env.S3_FORCE_PATH_STYLE) config.forcePathStyle = true;
  if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    };
  }
  return new S3Client(config);
}

/** Sem `S3_BUCKET` e `S3_PUBLIC_URL`, o storage fica desligado (upload responde 503). */
export function createPhotoStorage(env: PhotoStorageEnv): PhotoStorage {
  if (!env.S3_BUCKET || !env.S3_PUBLIC_URL) return new DisabledPhotoStorage();
  return new S3PhotoStorage({
    client: createS3Client(env),
    bucket: env.S3_BUCKET,
    publicUrl: env.S3_PUBLIC_URL,
  });
}
