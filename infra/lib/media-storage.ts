import { Annotations, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/** Onde a API grava o envio ainda não conferido. A regra de ciclo de vida apaga o que sobrar. */
export const UPLOADS_PREFIX = 'uploads/';

/**
 * O que a API publica depois de conferir: fotos e logos dos espaços, fotos de perfil e imagens dos
 * anúncios (`ads/<campaignId>/`, decisões 73 a 79).
 */
export const PUBLISHED_PREFIXES = ['spaces/', 'users/', 'ads/'] as const;

/** O navegador guarda o preflight do PUT pré-assinado por 1 hora. */
const CORS_MAX_AGE_SECONDS = 3600;

/** Aviso do CDK quando a origem com OAC recebe um bucket importado: a política fica por nossa conta. */
const IMPORTED_BUCKET_POLICY_WARNING =
  '@aws-cdk/aws-cloudfront-origins:updateImportedBucketPolicyOac';

export interface MediaStorageProps {
  bucketName: string;
  /** Usado na descrição da distribuição: `staging` ou `production`. */
  environment: string;
  /** Origens do web que enviam a foto direto ao bucket, pela URL pré-assinada. */
  corsOrigins: string[];
}

/**
 * Fotos de um ambiente (decisão 72): bucket privado e CloudFront com Origin Access Control na frente.
 * A API envia para `uploads/` por URL pré-assinada, confere a imagem e copia para `spaces/`,
 * `users/` ou `ads/`. Só esses três prefixos chegam ao CloudFront; `uploads/` nunca.
 */
export class MediaStorage extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(
    scope: Construct,
    id: string,
    { bucketName, environment, corsOrigins }: MediaStorageProps,
  ) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      // As fotos não voltam se o bucket sumir. Remover a stack deixa o bucket na conta (`infra/README.md`).
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { id: 'expire-uploads', prefix: UPLOADS_PREFIX, expiration: Duration.days(1) },
        { id: 'abort-incomplete-multipart', abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: corsOrigins,
          allowedHeaders: ['Content-Type'],
          maxAge: CORS_MAX_AGE_SECONDS,
        },
      ],
    });

    const originAccessControl = new cloudfront.S3OriginAccessControl(this, 'OriginAccessControl', {
      description: `Space Sports: fotos (${environment})`,
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });
    // Com o bucket da stack, `withOriginAccessControl` liberaria ao CloudFront `<bucket>/*`, o que
    // incluiria `uploads/`: um envio ainda não conferido ficaria público pela CDN. Com o bucket
    // importado, a origem só liga o OAC e não mexe na política, que vem logo abaixo, só com os
    // prefixos publicados. É o caminho do README do CDK para OAC com bucket importado.
    const origin = origins.S3BucketOrigin.withOriginAccessControl(
      s3.Bucket.fromBucketAttributes(this, 'OriginBucket', {
        bucketArn: this.bucket.bucketArn,
        bucketRegionalDomainName: this.bucket.bucketRegionalDomainName,
      }),
      { originAccessControl },
    );

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Space Sports: fotos (${environment})`,
      defaultBehavior: {
        origin,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // Ignora query string, cookies e cabeçalhos, com TTL padrão de 1 dia. As chaves têm UUID e
        // nunca são reescritas: uma foto trocada ganha outra URL.
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        // nosniff: o navegador não trata como HTML um arquivo enviado por usuário.
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      // Só a classe "All" inclui os pontos de presença da América do Sul.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });
    Annotations.of(this.distribution).acknowledgeWarning(
      IMPORTED_BUCKET_POLICY_WARNING,
      'A política do bucket é escrita abaixo, só com spaces/*, users/* e ads/*.',
    );

    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'CloudFrontReadsPublishedPrefixes',
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: PUBLISHED_PREFIXES.map((prefix) => this.bucket.arnForObjects(`${prefix}*`)),
        conditions: { StringEquals: { 'AWS:SourceArn': this.distribution.distributionArn } },
      }),
    );
  }

  /** Base pública das fotos, no formato de `S3_PUBLIC_URL`. */
  get publicUrl(): string {
    return `https://${this.distribution.distributionDomainName}`;
  }
}
