import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisabledPhotoStorage } from './photo-storage.js';
import { createPhotoStorage, createS3Client, S3PhotoStorage } from './s3-photo-storage.js';

// Cliente de verdade com chaves fixas (o presign é local, sem rede); `send` é simulado.
const client = createS3Client({
  S3_REGION: 'sa-east-1',
  S3_ENDPOINT: undefined,
  S3_FORCE_PATH_STYLE: false,
  S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  S3_SECRET_ACCESS_KEY: 'segredo-de-teste',
});
const storage = new S3PhotoStorage({
  client,
  bucket: 'space-sports-media-test',
  publicUrl: 'https://d1234.cloudfront.net/',
});

const metadata = (httpStatusCode: number) => ({ $metadata: { httpStatusCode } });
const noSuchKey = () =>
  new NoSuchKey({ message: 'The specified key does not exist.', ...metadata(404) });

function stubSend(impl: (command: unknown) => unknown) {
  return vi.spyOn(client, 'send').mockImplementation(async (command: unknown) => impl(command));
}

/** Corpo do GetObject como o SDK entrega (só o que o storage usa). */
const body = (bytes: Uint8Array<ArrayBuffer>) => ({
  transformToWebStream: () => new Response(bytes).body as ReadableStream<Uint8Array>,
});

describe('S3PhotoStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('presignUpload', () => {
    it('PUT pré-assinado com o Content-Type na assinatura e sem checksum do corpo', async () => {
      const upload = await storage.presignUpload('uploads/users/u1/avatar/x.jpg', 'image/jpeg');
      const url = new URL(upload.url);
      expect(url.host).toBe('space-sports-media-test.s3.sa-east-1.amazonaws.com');
      expect(url.pathname).toBe('/uploads/users/u1/avatar/x.jpg');
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
      // 5 minutos: no staging, as credenciais só são relidas a 5 minutos de expirar.
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(url.searchParams.get('X-Amz-Credential')).toMatch(
        /^AKIDEXAMPLE\/\d{8}\/sa-east-1\/s3\/aws4_request$/,
      );
      // Um checksum na URL seria o do corpo vazio e faria o upload do arquivo falhar.
      expect([...url.searchParams.keys()].some((key) => /checksum/i.test(key))).toBe(false);
      expect(upload.headers).toEqual({ 'Content-Type': 'image/jpeg' });
      expect(upload.expiresAt.getTime() - Date.now()).toBeGreaterThan(4 * 60 * 1000);
      expect(upload.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
    });

    it('MinIO: endpoint próprio e path-style', async () => {
      const minio = new S3PhotoStorage({
        client: createS3Client({
          S3_REGION: 'sa-east-1',
          S3_ENDPOINT: 'http://localhost:9000',
          S3_FORCE_PATH_STYLE: true,
          S3_ACCESS_KEY_ID: 'minio',
          S3_SECRET_ACCESS_KEY: 'minio-secret',
        }),
        bucket: 'space-sports',
        publicUrl: 'http://localhost:9000/space-sports',
      });
      const url = new URL((await minio.presignUpload('uploads/a/b.png', 'image/png')).url);
      expect(url.origin).toBe('http://localhost:9000');
      expect(url.pathname).toBe('/space-sports/uploads/a/b.png');
    });
  });

  describe('head', () => {
    it('tamanho e tipo do objeto; inexistente (NotFound) é null; outros erros lançam', async () => {
      const send = stubSend(() => ({ ContentLength: 1234, ContentType: 'image/png' }));
      expect(await storage.head('spaces/a/logo/x.png')).toEqual({
        size: 1234,
        contentType: 'image/png',
      });
      const command = send.mock.calls[0]?.[0];
      expect(command).toBeInstanceOf(HeadObjectCommand);
      expect((command as HeadObjectCommand).input).toEqual({
        Bucket: 'space-sports-media-test',
        Key: 'spaces/a/logo/x.png',
      });

      stubSend(() => {
        throw new NotFound({ message: 'NotFound', ...metadata(404) });
      });
      expect(await storage.head('k.png')).toBeNull();

      // 403 (ex.: papel sem s3:ListBucket) não pode virar "não enviado".
      stubSend(() => {
        throw new S3ServiceException({
          name: 'Forbidden',
          $fault: 'client',
          message: 'Forbidden',
          ...metadata(403),
        });
      });
      await expect(storage.head('k.png')).rejects.toThrow('Forbidden');
    });
  });

  describe('read', () => {
    it('GET com Range até maxBytes + 1', async () => {
      const send = stubSend(() => ({ Body: body(new Uint8Array([1, 2, 3])) }));
      expect(await storage.read('spaces/a/logo/x.jpg', 10)).toEqual(new Uint8Array([1, 2, 3]));
      const command = send.mock.calls[0]?.[0] as GetObjectCommand;
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toMatchObject({ Key: 'spaces/a/logo/x.jpg', Range: 'bytes=0-10' });
    });

    it('corta o corpo em maxBytes + 1 se o storage ignorar o Range', async () => {
      const big = new Uint8Array(100).map((_, i) => i);
      stubSend(() => ({ Body: body(big) }));
      expect(await storage.read('k.jpg', 10)).toEqual(big.subarray(0, 11));
    });

    it('NoSuchKey é null; objeto vazio (InvalidRange, 416) é vazio; outros erros lançam', async () => {
      stubSend(() => {
        throw noSuchKey();
      });
      expect(await storage.read('k.jpg', 10)).toBeNull();
      stubSend(() => {
        throw new S3ServiceException({
          name: 'InvalidRange',
          $fault: 'client',
          message: 'The requested range is not satisfiable',
          ...metadata(416),
        });
      });
      expect(await storage.read('k.jpg', 10)).toEqual(new Uint8Array());
      stubSend(() => {
        throw new S3ServiceException({
          name: 'InternalError',
          $fault: 'server',
          message: 'We encountered an internal error',
          ...metadata(500),
        });
      });
      await expect(storage.read('k.jpg', 10)).rejects.toThrow('internal error');
    });
  });

  describe('copy', () => {
    it('CopyObject no mesmo bucket, mantendo os metadados (Content-Type) da origem', async () => {
      const send = stubSend(() => ({ CopyObjectResult: {} }));
      expect(await storage.copy('uploads/spaces/a/logo/x.jpg', 'spaces/a/logo/x.jpg')).toBe(true);
      const command = send.mock.calls[0]?.[0] as CopyObjectCommand;
      expect(command).toBeInstanceOf(CopyObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'space-sports-media-test',
        Key: 'spaces/a/logo/x.jpg',
        CopySource: 'space-sports-media-test/uploads/spaces/a/logo/x.jpg',
        MetadataDirective: 'COPY',
      });
    });

    it('origem inexistente é false; outros erros lançam', async () => {
      stubSend(() => {
        throw noSuchKey();
      });
      expect(await storage.copy('a.jpg', 'b.jpg')).toBe(false);
      stubSend(() => {
        throw new Error('socket hang up');
      });
      await expect(storage.copy('a.jpg', 'b.jpg')).rejects.toThrow('socket hang up');
    });
  });

  describe('delete', () => {
    it('DeleteObject; falha só é logada (nunca lança)', async () => {
      const send = stubSend(() => ({}));
      await storage.delete('users/u1/avatar/x.jpg');
      const command = send.mock.calls[0]?.[0] as DeleteObjectCommand;
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'space-sports-media-test',
        Key: 'users/u1/avatar/x.jpg',
      });
      stubSend(() => {
        throw new Error('sem credenciais');
      });
      await expect(storage.delete('k.jpg')).resolves.toBeUndefined();
    });
  });

  describe('deletePrefix', () => {
    it('lista o prefixo página a página e apaga em lote', async () => {
      const pages = [
        {
          Contents: [{ Key: 'users/u1/avatar/a.jpg' }, { Key: 'users/u1/avatar/b.jpg' }],
          IsTruncated: true,
          NextContinuationToken: 'p2',
        },
        { Contents: [{ Key: 'users/u1/avatar/c.jpg' }], IsTruncated: false },
      ];
      const send = stubSend((command) =>
        command instanceof ListObjectsV2Command ? pages.shift() : { Deleted: [] },
      );
      expect(await storage.deletePrefix('users/u1/')).toBe(3);
      const commands = send.mock.calls.map(([command]) => command);
      expect(commands.map((c) => c?.constructor.name)).toEqual([
        'ListObjectsV2Command',
        'DeleteObjectsCommand',
        'ListObjectsV2Command',
        'DeleteObjectsCommand',
      ]);
      expect((commands[0] as ListObjectsV2Command).input).toEqual({
        Bucket: 'space-sports-media-test',
        Prefix: 'users/u1/',
        ContinuationToken: undefined,
      });
      expect((commands[2] as ListObjectsV2Command).input.ContinuationToken).toBe('p2');
      expect((commands[1] as DeleteObjectsCommand).input).toEqual({
        Bucket: 'space-sports-media-test',
        Delete: {
          Objects: [{ Key: 'users/u1/avatar/a.jpg' }, { Key: 'users/u1/avatar/b.jpg' }],
          Quiet: true,
        },
      });
    });

    it('prefixo vazio não apaga nada; erros parciais e falhas só são logados', async () => {
      const send = stubSend(() => ({ Contents: [], IsTruncated: false }));
      expect(await storage.deletePrefix('users/vazio/')).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);

      stubSend((command) =>
        command instanceof ListObjectsV2Command
          ? { Contents: [{ Key: 'a' }, { Key: 'b' }], IsTruncated: false }
          : { Errors: [{ Key: 'b', Code: 'AccessDenied' }] },
      );
      expect(await storage.deletePrefix('users/u2/')).toBe(1);

      stubSend(() => {
        throw new Error('sem permissão de listar');
      });
      await expect(storage.deletePrefix('users/u3/')).resolves.toBe(0);
    });
  });

  describe('publicUrl e keyFromUrl', () => {
    it('URL pública sob S3_PUBLIC_URL (sem barra dupla) e a volta para a chave', () => {
      expect(storage.publicUrl('users/u1/avatar/x.jpg')).toBe(
        'https://d1234.cloudfront.net/users/u1/avatar/x.jpg',
      );
      expect(storage.keyFromUrl('https://d1234.cloudfront.net/spaces/a/photos/x.jpg')).toBe(
        'spaces/a/photos/x.jpg',
      );
    });

    it('URL externa (foto do Google, Unsplash) ou de outro host é null', () => {
      expect(
        storage.keyFromUrl('https://lh3.googleusercontent.com/a/ACg8ocJ-foto=s96-c'),
      ).toBeNull();
      expect(
        storage.keyFromUrl('https://images.unsplash.com/photo-1-abc?w=1600&q=80&auto=format'),
      ).toBeNull();
      // Outro host com o mesmo prefixo não é do bucket.
      expect(storage.keyFromUrl('https://d1234.cloudfront.net.evil.com/spaces/a/x.jpg')).toBeNull();
      expect(storage.keyFromUrl('https://d1234.cloudfront.net/')).toBeNull();
      expect(storage.keyFromUrl('https://d1234.cloudfront.net')).toBeNull();
    });
  });
});

describe('createPhotoStorage', () => {
  const base = {
    S3_REGION: 'sa-east-1',
    S3_ENDPOINT: undefined,
    S3_FORCE_PATH_STYLE: false,
    S3_ACCESS_KEY_ID: undefined,
    S3_SECRET_ACCESS_KEY: undefined,
  };

  it('sem bucket e URL pública: desligado (upload responde 503)', () => {
    const disabled = createPhotoStorage({
      ...base,
      S3_BUCKET: undefined,
      S3_PUBLIC_URL: undefined,
    });
    expect(disabled).toBeInstanceOf(DisabledPhotoStorage);
    expect(disabled.enabled).toBe(false);
  });

  it('com bucket e URL pública: S3, sem chaves (cadeia padrão do SDK)', () => {
    const s3 = createPhotoStorage({
      ...base,
      S3_BUCKET: 'space-sports-media-staging',
      S3_PUBLIC_URL: 'https://d1234.cloudfront.net',
    });
    expect(s3).toBeInstanceOf(S3PhotoStorage);
    expect(s3.enabled).toBe(true);
  });
});
