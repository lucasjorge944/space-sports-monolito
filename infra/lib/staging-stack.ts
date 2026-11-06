import { readFileSync } from 'node:fs';
import { CfnOutput, Duration, Stack, type StackProps, Validations } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { SpaceSportsConfig } from './config.js';
import { MediaStorage } from './media-storage.js';
import { GITHUB_OIDC_AUDIENCE, GITHUB_OIDC_HOST, type SharedStack } from './shared-stack.js';

const INSTANCE_NAME = 'space-sports-staging';
const DNS_TTL = Duration.minutes(5);
const BOOTSTRAP_SCRIPT = new URL('../staging/bootstrap.sh', import.meta.url);
/** Nome fixo: o `staging/media-credentials.sh` monta o ARN a partir dele. */
export const MEDIA_ROLE_NAME = 'space-sports-staging-media';
/** O web em dev (`pnpm dev`) também envia fotos ao bucket do staging. */
const DEV_WEB_ORIGIN = 'http://localhost:3000';

interface StagingStackProps extends StackProps {
  config: SpaceSportsConfig;
  shared: SharedStack;
}

/**
 * Uma instância com tudo em Docker, sem NAT e sem SSH (decisão 56, staging enxuto), e as fotos no S3
 * com CloudFront (decisão 72).
 */
export class StagingStack extends Stack {
  private readonly availabilityZone: string;

  constructor(scope: Construct, id: string, { config, shared, ...props }: StagingStackProps) {
    super(scope, id, {
      ...props,
      description: 'Space Sports: staging em EC2 com Docker',
    });
    const { staging } = config;
    this.availabilityZone = staging.availabilityZone;

    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/24'),
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 26 }],
      // A opção cria uma Lambda, e nada aqui usa o security group padrão da VPC.
      restrictDefaultSecurityGroup: false,
    });

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      description: 'Staging: so HTTP e HTTPS de entrada; acesso pelo SSM Session Manager',
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP (ACME e redirect)');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    const parameterArns = this.parameterArns(staging.parameterPrefix);
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Staging: ECR (leitura), Parameter Store do staging e agente do SSM',
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
        resources: parameterArns,
      }),
    );
    // A política gerenciada libera ssm:GetParameter em `*`. Production vai usar a mesma conta, e a
    // chave aws/ssm decifra para quem pode ler o parâmetro: sem esta negação, quem entrasse no
    // staging leria os segredos de production.
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
        notResources: parameterArns,
      }),
    );
    for (const repository of shared.repositories) repository.grantPull(instanceRole);

    const media = new MediaStorage(this, 'Media', {
      bucketName: `space-sports-media-staging-${config.account}`,
      environment: 'staging',
      corsOrigins: [`https://${staging.webSubdomain}.${config.domainName}`, DEV_WEB_ORIGIN],
    });
    this.createMediaRole(media, instanceRole);
    // Não são segredo, mas ficam no grupo `api`, que o fetch-env.sh grava em env/api.env. O domínio do
    // CloudFront só existe depois do deploy, e a API exige S3_BUCKET e S3_PUBLIC_URL juntos: antes do
    // `cdk deploy` ela não recebe nenhum dos três e responde 503 no upload; depois, os três de uma vez.
    const apiVariables = [
      { id: 'MediaBucketParameter', name: 'S3_BUCKET', value: media.bucket.bucketName },
      { id: 'MediaRegionParameter', name: 'S3_REGION', value: this.region },
      { id: 'MediaPublicUrlParameter', name: 'S3_PUBLIC_URL', value: media.publicUrl },
    ];
    for (const { id, name, value } of apiVariables) {
      new ssm.StringParameter(this, id, {
        parameterName: `${staging.parameterPrefix}/api/${name}`,
        description: 'Fotos (decisao 72), gravado pelo CDK',
        stringValue: value,
      });
    }

    const instance = new ec2.Instance(this, 'Instance', {
      instanceName: INSTANCE_NAME,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup,
      role: instanceRole,
      instanceType: new ec2.InstanceType(staging.instanceType),
      // A T4g nasce em `unlimited`, que cobra à parte o uso de CPU acima da linha de base.
      creditSpecification: ec2.CpuCredits.STANDARD,
      machineImage: ec2.MachineImage.genericLinux({ [config.region]: staging.amiId }),
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(staging.diskSizeGb, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
      httpTokens: ec2.HttpTokens.REQUIRED,
      // A AL2023 usa 2 por padrão. Com 1, um contêiner na rede bridge não alcança o serviço de
      // metadados, e quem invadir a API não obtém as credenciais do papel da instância.
      httpPutResponseHopLimit: 1,
      userData: ec2.UserData.custom(readFileSync(BOOTSTRAP_SCRIPT, 'utf8')),
    });

    // O bootstrap baixa pacotes, e o CDK não faz a instância esperar a rota para a internet. Tem que
    // ser a dependência da subnet: a da VPC cobre só o Internet Gateway, não a rota.
    for (const subnet of vpc.publicSubnets) {
      instance.node.addDependency(subnet.internetConnectivityEstablished);
    }
    Validations.of(instance).acknowledge({
      id: 'CloudFormation-Validate::W9010',
      reason:
        'AMI fixa de propósito: com o parâmetro público do SSM, uma AMI nova substituiria a instância.',
    });

    const elasticIp = new ec2.CfnEIP(this, 'ElasticIp', {
      domain: 'vpc',
      tags: [{ key: 'Name', value: INSTANCE_NAME }],
    });
    new ec2.CfnEIPAssociation(this, 'ElasticIpAssociation', {
      allocationId: elasticIp.attrAllocationId,
      instanceId: instance.instanceId,
    });

    for (const subdomain of [staging.webSubdomain, staging.apiSubdomain]) {
      new route53.ARecord(this, `${subdomain}Record`, {
        zone: shared.hostedZone,
        recordName: subdomain,
        target: route53.RecordTarget.fromIpAddresses(elasticIp.attrPublicIp),
        ttl: DNS_TTL,
      });
    }

    // Não é segredo: é como a CI acha a instância, mesmo depois de uma substituição.
    const instanceIdParameter = new ssm.StringParameter(this, 'InstanceIdParameter', {
      parameterName: `${staging.parameterPrefix}/instance-id`,
      stringValue: instance.instanceId,
    });

    const deployRole = this.createDeployRole(config, shared);
    for (const repository of shared.repositories) {
      repository.grantPullPush(deployRole);
      repository.grant(deployRole, 'ecr:DescribeImages');
    }
    instanceIdParameter.grantRead(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:SendCommand'],
        resources: [
          this.formatArn({
            service: 'ec2',
            resource: 'instance',
            resourceName: instance.instanceId,
          }),
          this.formatArn({
            service: 'ssm',
            account: '',
            resource: 'document',
            resourceName: 'AWS-RunShellScript',
          }),
        ],
      }),
    );
    // Só leitura, e a AWS não aceita restrição por recurso nestas duas ações.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetCommandInvocation', 'ec2:DescribeInstanceStatus'],
        resources: ['*'],
      }),
    );

    // Rede de proteção do custo: desliga todo dia, e ligar é sempre manual (`infra/scripts/staging.sh`).
    const autoStopRole = new iam.Role(this, 'AutoStopRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
      description: 'Staging: desliga a instancia no horario agendado',
    });
    autoStopRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:StopInstances'],
        resources: [
          this.formatArn({
            service: 'ec2',
            resource: 'instance',
            resourceName: instance.instanceId,
          }),
        ],
      }),
    );
    new scheduler.CfnSchedule(this, 'AutoStopSchedule', {
      description: 'Desliga a instancia de staging todo dia',
      scheduleExpression: staging.autoStopCron,
      scheduleExpressionTimezone: 'America/Sao_Paulo',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances',
        roleArn: autoStopRole.roleArn,
        input: JSON.stringify({ InstanceIds: [instance.instanceId] }),
      },
    });

    new CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new CfnOutput(this, 'ElasticIpAddress', { value: elasticIp.attrPublicIp });
    new CfnOutput(this, 'DeployRoleArn', {
      description: 'Valor de AWS_DEPLOY_ROLE_ARN no GitHub',
      value: deployRole.roleArn,
    });
    new CfnOutput(this, 'MediaBucketName', {
      description: 'S3_BUCKET da API',
      value: media.bucket.bucketName,
    });
    new CfnOutput(this, 'MediaDistributionDomainName', {
      description: 'Dominio das fotos: S3_PUBLIC_URL = https://<dominio>',
      value: media.distribution.distributionDomainName,
    });
    new CfnOutput(this, 'MediaDistributionId', {
      description: 'Para invalidar o cache do CloudFront',
      value: media.distribution.distributionId,
    });
  }

  /** Sem esta sobrescrita, o `cdk synth` consulta a conta, e a CI e os testes não têm credenciais. */
  override get availabilityZones(): string[] {
    return [this.availabilityZone];
  }

  /**
   * Acesso às fotos para a API e o seed. Os contêineres não alcançam o serviço de metadados (limite de
   * saltos 1), então o host assume este papel e entrega a eles credenciais temporárias
   * (`staging/media-credentials.sh`). Quem invadir a API obtém só o acesso às fotos, nunca o papel da
   * instância, que lê os segredos e fala com o SSM. Sem chaves de acesso.
   */
  private createMediaRole(media: MediaStorage, instanceRole: iam.Role): iam.Role {
    const role = new iam.Role(this, 'MediaRole', {
      roleName: MEDIA_ROLE_NAME,
      description: 'Staging: fotos no S3 para os conteineres da API, assumido pela instancia',
      assumedBy: new iam.ArnPrincipal(instanceRole.roleArn),
      maxSessionDuration: Duration.hours(1),
    });
    role.grantAssumeRole(instanceRole);
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
        resources: [media.bucket.arnForObjects('*')],
      }),
    );
    // Sem ele, o HEAD de um objeto que não existe responde 403, e a API não distingue de falta de acesso.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [media.bucket.bucketArn],
      }),
    );
    return role;
  }

  /** O próprio prefixo, para `GetParametersByPath`, e tudo que está abaixo dele. */
  private parameterArns(prefix: string): string[] {
    const path = prefix.replace(/^\//, '');
    return [path, `${path}/*`].map((resourceName) =>
      this.formatArn({ service: 'ssm', resource: 'parameter', resourceName }),
    );
  }

  /**
   * Só o `main` do repositório assume este papel. Não use `environment:` no job do workflow: ele
   * troca o sufixo do `sub` para `:environment:<nome>`, e a AWS recusa o token.
   */
  private createDeployRole({ github }: SpaceSportsConfig, shared: SharedStack): iam.Role {
    return new iam.Role(this, 'GitHubDeployRole', {
      roleName: 'space-sports-staging-deploy',
      description: `Deploy do staging pelo GitHub Actions (${github.repository}, ${github.deployBranch})`,
      assumedBy: new iam.WebIdentityPrincipal(shared.githubOidcProvider.oidcProviderArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: GITHUB_OIDC_AUDIENCE,
          [`${GITHUB_OIDC_HOST}:sub`]: `${github.subjectPrefix}:ref:refs/heads/${github.deployBranch}`,
        },
      }),
    });
  }
}
