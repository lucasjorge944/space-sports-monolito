import { CfnOutput, Fn, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';
import type { SpaceSportsConfig } from './config.js';

/** `postgres` é a imagem própria do staging: ver `infra/staging/postgres/Dockerfile`. */
const IMAGE_NAMES = ['api', 'web', 'postgres'] as const;
const IMAGES_TO_KEEP = 5;

export const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';
export const GITHUB_OIDC_AUDIENCE = 'sts.amazonaws.com';

interface SharedStackProps extends StackProps {
  config: SpaceSportsConfig;
}

/**
 * O que staging e production vão dividir na mesma conta: a zona DNS, os repositórios de imagem e o
 * provedor OIDC, que só pode existir uma vez por conta. Fica fora da stack do staging para ela
 * poder ser destruída sem trocar os nameservers do Registro.br.
 */
export class SharedStack extends Stack {
  readonly hostedZone: route53.PublicHostedZone;
  readonly repositories: ecr.Repository[];
  readonly githubOidcProvider: iam.OidcProviderNative;

  constructor(scope: Construct, id: string, { config, ...props }: SharedStackProps) {
    super(scope, id, {
      ...props,
      terminationProtection: true,
      description: 'Space Sports: DNS, imagens e OIDC do GitHub, comuns aos ambientes',
    });

    this.hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
      zoneName: config.domainName,
    });
    this.hostedZone.applyRemovalPolicy(RemovalPolicy.RETAIN);

    this.repositories = IMAGE_NAMES.map(
      (name) =>
        new ecr.Repository(this, `${name}Repository`, {
          repositoryName: `space-sports/${name}`,
          imageTagMutability: ecr.TagMutability.IMMUTABLE,
          lifecycleRules: [
            {
              description: `Guarda as ${IMAGES_TO_KEEP} imagens mais recentes`,
              maxImageCount: IMAGES_TO_KEEP,
            },
          ],
        }),
    );

    this.githubOidcProvider = new iam.OidcProviderNative(this, 'GitHubOidcProvider', {
      url: `https://${GITHUB_OIDC_HOST}`,
      clientIds: [GITHUB_OIDC_AUDIENCE],
    });

    new CfnOutput(this, 'NameServers', {
      description: 'Nameservers para configurar no Registro.br',
      value: Fn.join(',', this.hostedZone.hostedZoneNameServers ?? []),
    });
  }
}
