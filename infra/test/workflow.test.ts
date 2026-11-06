import { describe, expect, it } from 'vitest';
import { parseYaml } from './helpers.js';

const workflow = parseYaml('../.github/workflows/deploy-staging.yml');
const { instance, deploy } = workflow.jobs;
const steps: { name?: string; uses?: string; with?: Record<string, string> }[] = deploy.steps;

describe('deploy-staging.yml', () => {
  it('dispara depois da CI no main e manualmente', () => {
    expect(workflow.on.workflow_run).toEqual({
      workflows: ['CI'],
      types: ['completed'],
      branches: ['main'],
    });
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(instance.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(instance.if).toContain("github.event.workflow_run.event == 'push'");
  });

  it('confere a origem do workflow_run, porque o filtro branches só olha o nome', () => {
    expect(instance.if).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(instance.if).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository',
    );
  });

  it('no disparo manual, só aceita o main', () => {
    expect(instance.if).toContain("github.ref == 'refs/heads/main'");
  });

  it('fixa por SHA as actions da AWS e do Docker, que manuseiam as credenciais', () => {
    const pinned = [...instance.steps, ...deploy.steps]
      .map((step: { uses?: string }) => step.uses)
      .filter((uses?: string) => uses?.match(/^(aws-actions|docker)\//));
    expect(pinned.length).toBeGreaterThanOrEqual(7);
    for (const uses of pinned) expect(uses).toMatch(/@[0-9a-f]{40}$/);
  });

  it('é pulado enquanto a variável do papel não existir', () => {
    expect(instance.if).toContain("vars.AWS_DEPLOY_ROLE_ARN != ''");
    expect(deploy.needs).toBe('instance');
  });

  it('só constrói as imagens com a instância ligada, para não gastar a cota do plano', () => {
    expect(deploy.if).toBe("needs.instance.outputs.running == 'true'");
  });

  it('não usa environment, que mudaria o sub do OIDC', () => {
    for (const job of [instance, deploy]) {
      expect(job).not.toHaveProperty('environment');
      expect(job.permissions['id-token']).toBe('write');
    }
  });

  it('constrói as imagens em arm64 em runner nativo, sem QEMU', () => {
    expect(deploy['runs-on']).toBe('ubuntu-24.04-arm');
    const builds = steps.filter((step) => step.uses?.startsWith('docker/build-push-action'));
    expect(builds).toHaveLength(3);
    for (const build of builds) expect(build.with?.platforms).toBe('linux/arm64');
    expect(steps.some((step) => step.uses?.startsWith('docker/setup-qemu-action'))).toBe(false);
  });

  it('usa o commit aprovado pela CI, e não o último do main', () => {
    expect(deploy.env.IMAGE_TAG).toContain('github.event.workflow_run.head_sha');
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout'));
    expect(checkout?.with?.ref).toContain('env.IMAGE_TAG');
  });

  it('fixa o rewrite do web no serviço da API do compose', () => {
    const web = steps.find((step) => step.with?.file === 'apps/web/Dockerfile');
    expect(web?.with?.['build-args']).toBe('API_URL=http://api:3333');
  });
});
