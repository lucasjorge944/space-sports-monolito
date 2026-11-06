import { describe, expect, it } from 'vitest';
import { synthesize } from './helpers.js';

const { staging } = synthesize();

interface Statement {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Principal?: unknown;
  Resource?: unknown;
  Condition?: unknown;
}

const asArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);
const actionsOf = (statements: Statement[]) => statements.flatMap((s) => asArray(s.Action));

const only = (type: string) => {
  const resources = Object.entries(staging.findResources(type));
  expect(resources, type).toHaveLength(1);
  const [entry] = resources;
  if (!entry) throw new Error(type);
  return { id: entry[0], resource: entry[1] };
};

const bucket = only('AWS::S3::Bucket');
const distribution = only('AWS::CloudFront::Distribution');
const bucketPolicy: Statement[] =
  only('AWS::S3::BucketPolicy').resource.Properties.PolicyDocument.Statement;

const roleId = (match: (role: object) => boolean) => {
  const found = Object.entries(staging.findResources('AWS::IAM::Role')).find(([, r]) => match(r));
  if (!found) throw new Error('Papel não encontrado');
  return found[0];
};
const mediaRoleId = roleId((role) => JSON.stringify(role).includes('space-sports-staging-media'));
const instanceRoleId = roleId((role) => JSON.stringify(role).includes('ec2.amazonaws.com'));

const statementsOf = (id: string): Statement[] =>
  Object.values(staging.findResources('AWS::IAM::Policy'))
    .filter((policy) => JSON.stringify(policy.Properties.Roles).includes(`"${id}"`))
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement);

/** `{"Fn::Join": ["", [{"Fn::GetAtt": [bucket, "Arn"]}, "/spaces/*"]]}` → `"/spaces/*"`. */
const objectPatterns = (resource: unknown) =>
  asArray(resource).map((r) => JSON.stringify(r).match(/"(\/[^"]*)"\]\]\}$/)?.[1] ?? 'bucket');

describe('bucket das fotos', () => {
  it('tem o nome do ambiente e da conta e fica na conta se a stack for removida', () => {
    staging.hasResource('AWS::S3::Bucket', {
      Properties: { BucketName: 'space-sports-media-staging-123456789012' },
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('bloqueia todo acesso público, sem ACLs', () => {
    staging.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
    });
  });

  it('criptografa com SSE-S3 e não versiona', () => {
    const properties = bucket.resource.Properties;
    expect(properties.BucketEncryption.ServerSideEncryptionConfiguration).toEqual([
      { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
    ]);
    expect(properties.VersioningConfiguration).toBeUndefined();
  });

  it('expira só uploads/ em 1 dia e aborta multipart incompleto em 1 dia', () => {
    const rules: Record<string, unknown>[] =
      bucket.resource.Properties.LifecycleConfiguration.Rules;
    expect(rules).toContainEqual(
      expect.objectContaining({ Prefix: 'uploads/', ExpirationInDays: 1, Status: 'Enabled' }),
    );
    expect(rules).toContainEqual(
      expect.objectContaining({
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
        Status: 'Enabled',
      }),
    );
    // Uma regra de expiração fora de uploads/ apagaria fotos publicadas.
    const expiring = rules.filter((rule) => 'ExpirationInDays' in rule || 'ExpirationDate' in rule);
    expect(expiring.map((rule) => rule.Prefix)).toEqual(['uploads/']);
  });

  it('aceita PUT e GET do web do staging e do dev, só com Content-Type', () => {
    expect(bucket.resource.Properties.CorsConfiguration.CorsRules).toEqual([
      {
        AllowedMethods: ['PUT', 'GET'],
        AllowedOrigins: ['https://staging.spacesports.com.br', 'http://localhost:3000'],
        AllowedHeaders: ['Content-Type'],
        MaxAge: 3600,
      },
    ]);
  });

  it('recusa conexões sem TLS', () => {
    expect(bucketPolicy).toContainEqual(
      expect.objectContaining({
        Effect: 'Deny',
        Action: 's3:*',
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      }),
    );
  });
});

describe('política do bucket', () => {
  const allows = bucketPolicy.filter((s) => s.Effect === 'Allow');

  it('só o CloudFront lê, e só spaces/*, users/* e ads/*', () => {
    expect(allows).toHaveLength(1);
    const [statement] = allows;
    expect(statement?.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
    expect(statement?.Action).toBe('s3:GetObject');
    expect(objectPatterns(statement?.Resource).sort()).toEqual(['/ads/*', '/spaces/*', '/users/*']);
  });

  it('nunca libera uploads/ nem o bucket inteiro', () => {
    for (const statement of allows) {
      const patterns = objectPatterns(statement.Resource);
      expect(patterns.filter((p) => p.startsWith('/uploads') || p === '/*')).toEqual([]);
    }
  });

  it('só a distribuição das fotos usa a liberação', () => {
    const condition = JSON.stringify(allows[0]?.Condition);
    expect(condition).toContain('"AWS:SourceArn"');
    expect(condition).toContain(':cloudfront::123456789012:distribution/');
    expect(condition).toContain(`{"Ref":"${distribution.id}"}`);
  });
});

describe('CloudFront das fotos', () => {
  const config = distribution.resource.Properties.DistributionConfig;

  it('lê o bucket pelo Origin Access Control, sem OAI', () => {
    staging.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: {
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
      },
    });
    const oac = only('AWS::CloudFront::OriginAccessControl');
    expect(config.Origins).toEqual([
      expect.objectContaining({
        DomainName: { 'Fn::GetAtt': [bucket.id, 'RegionalDomainName'] },
        OriginAccessControlId: { 'Fn::GetAtt': [oac.id, 'Id'] },
        S3OriginConfig: { OriginAccessIdentity: '' },
      }),
    ]);
    staging.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0);
  });

  it('só GET e HEAD, HTTPS obrigatório e cache otimizado', () => {
    expect(config.DefaultCacheBehavior).toMatchObject({
      AllowedMethods: ['GET', 'HEAD'],
      CachedMethods: ['GET', 'HEAD'],
      ViewerProtocolPolicy: 'redirect-to-https',
      // CachingOptimized, política gerenciada da AWS.
      CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
      Compress: true,
    });
    expect(config.CacheBehaviors).toBeUndefined();
  });

  it('manda nosniff e os demais cabeçalhos de segurança', () => {
    // SecurityHeadersPolicy, política gerenciada da AWS.
    expect(config.DefaultCacheBehavior.ResponseHeadersPolicyId).toBe(
      '67f7725c-6f97-4210-82d7-5512b31e9d03',
    );
  });

  it('usa o domínio padrão do CloudFront no staging, com os pontos da América do Sul', () => {
    expect(config.Aliases).toBeUndefined();
    expect(config.ViewerCertificate).toBeUndefined();
    expect(config.PriceClass).toBe('PriceClass_All');
  });
});

describe('papel de mídia', () => {
  const statements = statementsOf(mediaRoleId);

  it('só o papel da instância assume, por no máximo 1 hora', () => {
    const role = staging.findResources('AWS::IAM::Role')[mediaRoleId];
    expect(role?.Properties.MaxSessionDuration).toBe(3600);
    expect(role?.Properties.AssumeRolePolicyDocument.Statement).toEqual([
      {
        Action: 'sts:AssumeRole',
        Effect: 'Allow',
        Principal: { AWS: { 'Fn::GetAtt': [instanceRoleId, 'Arn'] } },
      },
    ]);
  });

  it('grava, lê e apaga objetos do bucket e lista o bucket, nada mais', () => {
    expect(statements).toHaveLength(2);
    const objects = statements.find((s) => actionsOf([s]).includes('s3:PutObject'));
    expect(actionsOf(objects ? [objects] : []).sort()).toEqual([
      's3:DeleteObject',
      's3:GetObject',
      's3:PutObject',
    ]);
    expect(objects?.Resource).toEqual({
      'Fn::Join': ['', [{ 'Fn::GetAtt': [bucket.id, 'Arn'] }, '/*']],
    });

    const list = statements.find((s) => actionsOf([s]).includes('s3:ListBucket'));
    expect(actionsOf(list ? [list] : [])).toEqual(['s3:ListBucket']);
    expect(list?.Resource).toEqual({ 'Fn::GetAtt': [bucket.id, 'Arn'] });
    expect(statements.every((s) => s.Effect === 'Allow')).toBe(true);
  });

  it('a instância só assume o papel, sem acesso direto ao S3', () => {
    const instance = statementsOf(instanceRoleId);
    const actions = actionsOf(instance);
    expect(actions.filter((action) => action.startsWith('s3:'))).toEqual([]);
    const assume = instance.filter((s) => actionsOf([s]).includes('sts:AssumeRole'));
    expect(assume).toEqual([
      {
        Action: 'sts:AssumeRole',
        Effect: 'Allow',
        Resource: { 'Fn::GetAtt': [mediaRoleId, 'Arn'] },
      },
    ]);
  });

  it('nenhum usuário IAM nem chave de acesso', () => {
    staging.resourceCountIs('AWS::IAM::User', 0);
    staging.resourceCountIs('AWS::IAM::AccessKey', 0);
  });
});

describe('configuração da API', () => {
  it('grava S3_BUCKET, S3_REGION e S3_PUBLIC_URL no grupo api do Parameter Store', () => {
    const parameters = Object.values(staging.findResources('AWS::SSM::Parameter'))
      .map((parameter) => parameter.Properties)
      .filter((properties) => properties.Name.startsWith('/space-sports/staging/api/'));
    expect(parameters.map((properties) => properties.Name).sort()).toEqual([
      '/space-sports/staging/api/S3_BUCKET',
      '/space-sports/staging/api/S3_PUBLIC_URL',
      '/space-sports/staging/api/S3_REGION',
    ]);
    const value = (name: string) =>
      parameters.find((properties) => properties.Name.endsWith(`/${name}`))?.Value;
    expect(value('S3_BUCKET')).toEqual({ Ref: bucket.id });
    expect(value('S3_REGION')).toBe('sa-east-1');
    expect(value('S3_PUBLIC_URL')).toEqual({
      'Fn::Join': ['', ['https://', { 'Fn::GetAtt': [distribution.id, 'DomainName'] }]],
    });
    // Não são segredo: String, e nenhum SecureString criado pelo CDK.
    expect(parameters.every((properties) => properties.Type === 'String')).toBe(true);
  });

  it('exporta o bucket e o domínio', () => {
    staging.hasOutput('MediaBucketName', { Value: { Ref: bucket.id } });
    staging.hasOutput('MediaDistributionDomainName', {
      Value: { 'Fn::GetAtt': [distribution.id, 'DomainName'] },
    });
    staging.hasOutput('MediaDistributionId', { Value: { Ref: distribution.id } });
  });

  it('a stack não tem outro bucket nem distribuição', () => {
    staging.resourceCountIs('AWS::S3::Bucket', 1);
    staging.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });
});
