import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { cdkContext, synthesize } from './helpers.js';

const { shared, staging } = synthesize();

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource?: unknown;
  NotResource?: unknown;
}

const asArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

const roleLogicalId = (template: typeof staging, service: 'ec2' | 'oidc') => {
  const roles = template.findResources('AWS::IAM::Role');
  const found = Object.entries(roles).find(([, role]) =>
    service === 'ec2'
      ? JSON.stringify(role).includes('ec2.amazonaws.com')
      : JSON.stringify(role).includes('sts:AssumeRoleWithWebIdentity'),
  );
  if (!found) throw new Error(`Papel ${service} não encontrado`);
  return found[0];
};

/** Declarações das políticas inline ligadas ao papel. */
const statementsOf = (roleId: string): Statement[] =>
  Object.values(staging.findResources('AWS::IAM::Policy'))
    .filter((policy) => JSON.stringify(policy.Properties.Roles).includes(roleId))
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement);

const actionsOf = (statements: Statement[]) => statements.flatMap((s) => asArray(s.Action));

describe('desligamento automático', () => {
  it('para só a instância de staging às 20h de Brasília, sem Lambda', () => {
    staging.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0 20 * * ? *)',
      ScheduleExpressionTimezone: 'America/Sao_Paulo',
      State: Match.absent(),
      Target: {
        Arn: 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances',
        Input: { 'Fn::Join': Match.anyValue() },
      },
    });
    const role = Object.entries(staging.findResources('AWS::IAM::Role')).find(([, r]) =>
      JSON.stringify(r).includes('scheduler.amazonaws.com'),
    );
    if (!role) throw new Error('Papel do agendamento não encontrado');
    const statements = statementsOf(role[0]);
    expect(actionsOf(statements)).toEqual(['ec2:StopInstances']);
    expect(JSON.stringify(statements[0]?.Resource)).toContain('instance/');
  });
});

describe('rede', () => {
  it('não tem NAT Gateway e só tem subnet pública', () => {
    staging.resourceCountIs('AWS::EC2::NatGateway', 0);
    staging.resourceCountIs('AWS::EC2::Subnet', 1);
    staging.hasResourceProperties('AWS::EC2::Subnet', { MapPublicIpOnLaunch: true });
    staging.hasResourceProperties('AWS::EC2::Route', {
      DestinationCidrBlock: '0.0.0.0/0',
      GatewayId: Match.anyValue(),
    });
  });

  it('só aceita 80 e 443, sem SSH', () => {
    const groups = Object.values(staging.findResources('AWS::EC2::SecurityGroup'));
    expect(groups).toHaveLength(1);
    const ingress = groups[0]?.Properties.SecurityGroupIngress;
    expect(ingress.map((rule: { FromPort: number }) => rule.FromPort).sort()).toEqual([443, 80]);
    for (const rule of ingress) {
      expect(rule.IpProtocol).toBe('tcp');
      expect(rule.ToPort).toBe(rule.FromPort);
    }
    staging.resourceCountIs('AWS::EC2::SecurityGroupIngress', 0);
  });

  it('não usa Lambda nem recurso customizado, que exigiriam assets no bootstrap', () => {
    for (const template of [shared, staging]) {
      template.resourceCountIs('AWS::Lambda::Function', 0);
      expect(template.findResources('Custom::AWS')).toEqual({});
    }
  });
});

describe('instância', () => {
  it('é uma t4g.small da AMI arm64 configurada, com gp3 de 20 GB criptografado', () => {
    staging.resourceCountIs('AWS::EC2::Instance', 1);
    staging.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't4g.small',
      ImageId: cdkContext.spaceSports.staging.amiId,
      BlockDeviceMappings: [
        {
          DeviceName: '/dev/xvda',
          Ebs: { VolumeType: 'gp3', VolumeSize: 20, Encrypted: true, DeleteOnTermination: true },
        },
      ],
    });
  });

  it('exige IMDSv2 e não deixa contêineres alcançarem o serviço de metadados', () => {
    staging.hasResourceProperties('AWS::EC2::Instance', {
      MetadataOptions: { HttpTokens: 'required', HttpPutResponseHopLimit: 1 },
    });
  });

  it('não permite cobrança de crédito extra de CPU', () => {
    staging.hasResourceProperties('AWS::EC2::Instance', {
      CreditSpecification: { CPUCredits: 'standard' },
    });
  });

  it('não tem par de chaves', () => {
    const [instance] = Object.values(staging.findResources('AWS::EC2::Instance'));
    expect(instance?.Properties.KeyName).toBeUndefined();
  });

  it('instala o Docker e cria 2 GB de swap no bootstrap', () => {
    const [instance] = Object.values(staging.findResources('AWS::EC2::Instance'));
    const userData: string = instance?.Properties.UserData['Fn::Base64'];
    expect(userData).toContain('retry dnf install -y docker');
    expect(userData).toContain('count=2048');
    expect(userData).toContain('docker-compose-linux-aarch64');
  });

  it('cria a pasta do deploy antes de tudo, para o deploy alcançar a espera do bootstrap', () => {
    const [instance] = Object.values(staging.findResources('AWS::EC2::Instance'));
    const userData: string = instance?.Properties.UserData['Fn::Base64'];
    const folder = userData.indexOf('install -d -m 750 /opt/space-sports');
    expect(folder).toBeGreaterThan(-1);
    expect(folder).toBeLessThan(userData.indexOf('dd if=/dev/zero'));
    expect(folder).toBeLessThan(userData.indexOf('retry dnf'));
  });

  it('espera a rota para a internet antes de subir, porque o bootstrap baixa pacotes', () => {
    const [instance] = Object.values(staging.findResources('AWS::EC2::Instance'));
    expect(JSON.stringify(instance?.DependsOn)).toContain('DefaultRoute');
  });

  it('tem Elastic IP e os registros A de staging e api-staging', () => {
    staging.resourceCountIs('AWS::EC2::EIP', 1);
    staging.resourceCountIs('AWS::EC2::EIPAssociation', 1);
    staging.resourceCountIs('AWS::Route53::RecordSet', 2);
    for (const name of ['staging.spacesports.com.br.', 'api-staging.spacesports.com.br.']) {
      staging.hasResourceProperties('AWS::Route53::RecordSet', {
        Name: name,
        Type: 'A',
        ResourceRecords: [{ 'Fn::GetAtt': [Match.anyValue(), 'PublicIp'] }],
      });
    }
  });
});

describe('papel da instância', () => {
  const statements = statementsOf(roleLogicalId(staging, 'ec2'));

  it('lê parâmetros só do prefixo do staging', () => {
    const template = JSON.stringify(
      statements.find((s) => s.Effect === 'Allow' && actionsOf([s]).includes('ssm:GetParameter')),
    );
    expect(template).toContain(':parameter/space-sports/staging"');
    expect(template).toContain(':parameter/space-sports/staging/*"');
  });

  it('nega parâmetros fora do prefixo, que a política gerenciada do SSM liberaria', () => {
    const deny = statements.find((s) => s.Effect === 'Deny');
    expect(actionsOf(deny ? [deny] : [])).toEqual(
      expect.arrayContaining(['ssm:GetParameter', 'ssm:GetParameters']),
    );
    expect(JSON.stringify(deny?.NotResource)).toContain(':parameter/space-sports/staging/*"');
  });

  it('só faz pull do ECR', () => {
    const actions = actionsOf(statements);
    expect(actions).toEqual(expect.arrayContaining(['ecr:BatchGetImage']));
    expect(actions).not.toContain('ecr:PutImage');
    expect(actions.filter((action) => action.endsWith(':*') || action === '*')).toEqual([]);
  });

  it('usa a política gerenciada do SSM', () => {
    staging.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [Match.objectLike({ Principal: { Service: 'ec2.amazonaws.com' } })],
      }),
      ManagedPolicyArns: [
        Match.objectLike({
          'Fn::Join': ['', Match.arrayWith([':iam::aws:policy/AmazonSSMManagedInstanceCore'])],
        }),
      ],
    });
  });
});

describe('deploy pelo GitHub', () => {
  const statements = statementsOf(roleLogicalId(staging, 'oidc'));

  it('cria o provedor OIDC do GitHub', () => {
    shared.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    });
  });

  it('só o main do repositório assume o papel, no formato imutável do sub', () => {
    const roles = staging.findResources('AWS::IAM::Role');
    const role = roles[roleLogicalId(staging, 'oidc')];
    const [trust, ...others] = role?.Properties.AssumeRolePolicyDocument.Statement ?? [];
    expect(others).toEqual([]);
    expect(trust.Action).toBe('sts:AssumeRoleWithWebIdentity');
    expect(trust.Condition).toEqual({
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        'token.actions.githubusercontent.com:sub':
          'repo:Space-Sports-Apps@100000001/mobile-web@200000002:ref:refs/heads/main',
      },
    });
  });

  it('envia comandos só para a instância de staging e só com o AWS-RunShellScript', () => {
    const send = statements.find((s) => actionsOf([s]).includes('ssm:SendCommand'));
    const resources = JSON.stringify(send?.Resource);
    expect(asArray(send?.Resource)).toHaveLength(2);
    expect(resources).toContain(':instance/');
    expect(resources).toContain('::document/AWS-RunShellScript');
  });

  it('não tem curingas de ação nem acesso a IAM', () => {
    const actions = actionsOf(statements);
    expect(actions.filter((action) => action.includes('*'))).toEqual([]);
    expect(actions.filter((action) => action.startsWith('iam:'))).toEqual([]);
  });

  it('só usa Resource "*" no que a AWS não restringe por recurso', () => {
    const unscoped = statements
      .filter((s) => s.Resource === '*')
      .flatMap((s) => actionsOf([s]))
      .sort();
    expect(unscoped).toEqual([
      'ec2:DescribeInstanceStatus',
      'ecr:GetAuthorizationToken',
      'ssm:GetCommandInvocation',
    ]);
  });
});

describe('recursos compartilhados', () => {
  it('cria a zona de spacesports.com.br e a preserva se a stack for removida', () => {
    shared.hasResource('AWS::Route53::HostedZone', {
      Properties: { Name: 'spacesports.com.br.' },
      DeletionPolicy: 'Retain',
    });
  });

  it('cria os repositórios com tag imutável e lifecycle de poucas imagens', () => {
    shared.resourceCountIs('AWS::ECR::Repository', 3);
    for (const name of ['api', 'web', 'postgres']) {
      shared.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: `space-sports/${name}`,
        ImageTagMutability: 'IMMUTABLE',
        LifecyclePolicy: {
          LifecyclePolicyText: Match.stringLikeRegexp('"countNumber":5'),
        },
      });
    }
  });
});
