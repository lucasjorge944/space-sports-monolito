import { describe, expect, it } from 'vitest';
import { cdkContext, parseYaml, readInfraFile, synthesize } from './helpers.js';

const { region, domainName, github, staging } = cdkContext.spaceSports;
const webHost = `${staging.webSubdomain}.${domainName}`;
const apiHost = `${staging.apiSubdomain}.${domainName}`;

/** Hosts sob o domínio configurado e, para detectar um domínio antigo, sob qualquer `.com.br`. */
const hostsIn = (text: string) => new Set(text.match(/[\w.-]+\.com\.br/g));

/**
 * O compose, o Caddyfile e os scripts rodam fora do CDK e repetem valores do `cdk.json`. Uma troca de
 * domínio ou de prefixo sem atualizar os dois lados compila, faz o synth e só quebra no servidor.
 */
describe('valores repetidos fora do cdk.json', () => {
  describe('compose.yml', () => {
    const { api, web } = parseYaml('staging/compose.yml').services;

    it('usa os domínios configurados', () => {
      expect(api.environment.BETTER_AUTH_URL).toBe(`https://${apiHost}`);
      expect(api.environment.WEB_URL).toBe(`https://${webHost}`);
      expect(api.environment.TRUSTED_ORIGINS.split(',')).toContain(`https://${webHost}`);
      expect(web.environment.SITE_URL).toBe(`https://${webHost}`);
      expect(api.environment.SMTP_FROM).toContain(`@${domainName}>`);
    });

    it('não cita outro domínio', () => {
      const allowed = new Set([webHost, apiHost, domainName]);
      expect(hostsIn(readInfraFile('staging/compose.yml'))).toEqual(allowed);
    });
  });

  describe('fotos', () => {
    const template = synthesize().staging;
    const [[bucketId, bucket] = []] = Object.entries(template.findResources('AWS::S3::Bucket'));
    const mediaRole = Object.values(template.findResources('AWS::IAM::Role')).find((role) =>
      JSON.stringify(role).includes('fotos no S3'),
    );
    const { api } = parseYaml('staging/compose.yml').services;
    const script = readInfraFile('staging/media-credentials.sh');
    const setting = (name: string) =>
      script.match(new RegExp(`^(?:export )?${name}=(\\S+)$`, 'm'))?.[1];

    it('a stack grava para a API o bucket dela e a região configurada', () => {
      expect(bucket?.Properties.BucketName).toMatch(/^space-sports-media-staging-\d{12}$/);
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: `${staging.parameterPrefix}/api/S3_BUCKET`,
        Value: { Ref: bucketId },
      });
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: `${staging.parameterPrefix}/api/S3_REGION`,
        Value: region,
      });
    });

    it('o media-credentials.sh assume o papel que a stack cria, na região configurada', () => {
      expect(setting('ROLE_NAME')).toBe(mediaRole?.Properties.RoleName);
      expect(setting('AWS_DEFAULT_REGION')).toBe(region);
      expect(Number(setting('SESSION_DURATION'))).toBeLessThanOrEqual(
        mediaRole?.Properties.MaxSessionDuration,
      );
    });

    it('o SDK acha a configuração e as credenciais na pasta que o compose monta', () => {
      const mount = api.volumes.find((volume: string) => volume.startsWith('./aws:'));
      const target = mount?.split(':')[1];
      expect(api.environment.AWS_CONFIG_FILE).toBe(`${target}/config`);
      expect(script).toContain(`credential_process = cat ${target}/media.json`);
    });

    it('os três S3_* vão para o grupo que o fetch-env.sh grava no env da API', () => {
      expect(readInfraFile('staging/fetch-env.sh')).toMatch(/for group in [^;]*\bapi\b/);
      for (const name of ['S3_BUCKET', 'S3_REGION', 'S3_PUBLIC_URL']) {
        template.hasResourceProperties('AWS::SSM::Parameter', {
          Name: `${staging.parameterPrefix}/api/${name}`,
          Type: 'String',
        });
        expect(api.environment, name).not.toHaveProperty(name);
      }
    });
  });

  it('o Caddyfile atende exatamente os dois domínios', () => {
    const caddyfile = readInfraFile('staging/Caddyfile');
    expect(hostsIn(caddyfile)).toEqual(new Set([webHost, apiHost]));
    expect(caddyfile).toMatch(new RegExp(`^${webHost.replaceAll('.', '\\.')} \\{`, 'm'));
    expect(caddyfile).toMatch(new RegExp(`^${apiHost.replaceAll('.', '\\.')} \\{`, 'm'));
  });

  it('o fetch-env.sh lê o prefixo configurado', () => {
    expect(readInfraFile('staging/fetch-env.sh')).toContain(`PREFIX=${staging.parameterPrefix}\n`);
  });

  describe('deploy-staging.yml', () => {
    const workflow = parseYaml('github-workflows-desativados/deploy-staging.yml');

    it('usa a região configurada', () => {
      expect(workflow.env.AWS_REGION).toBe(region);
    });

    it('acha a instância pelo parâmetro que a stack cria', () => {
      const state = workflow.jobs.instance.steps.find((s: { id?: string }) => s.id === 'state');
      const parameterName = `${staging.parameterPrefix}/instance-id`;
      expect(state.run).toContain(`--name ${parameterName} `);
      synthesize().staging.hasResourceProperties('AWS::SSM::Parameter', { Name: parameterName });
    });
  });

  describe('staging.sh', () => {
    const script = readInfraFile('scripts/staging.sh');

    it('usa a região e o repositório configurados', () => {
      expect(script).toContain(`AWS_REGION=\${AWS_REGION:-${region}}`);
      expect(script).toContain(`--repo ${github.repository} `);
    });

    it('procura a instância pelo nome que a stack dá a ela', () => {
      const [instance] = Object.values(synthesize().staging.findResources('AWS::EC2::Instance'));
      const tags: { Key: string; Value: string }[] = instance?.Properties.Tags ?? [];
      const name = tags.find((tag) => tag.Key === 'Name')?.Value;
      expect(script).toContain(`INSTANCE_NAME=${name}\n`);
    });
  });

  it('o apply-staging.sh entra na pasta que o bootstrap cria', () => {
    const folder = readInfraFile('staging/bootstrap.sh').match(/install -d -m 750 (\S+)/)?.[1];
    expect(readInfraFile('scripts/apply-staging.sh')).toContain(`"cd ${folder}"`);
  });
});
