import type { Node } from 'constructs';
import { z } from 'zod';

const githubSchema = z
  .object({
    /** `<organização>/<repositório>`. */
    repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    /**
     * Prefixo do claim `sub` do token OIDC. Repositórios criados depois de 15/07/2026 emitem o
     * formato imutável, com os ids numéricos, e o formato só com nomes é recusado pela AWS:
     * `gh api repos/<repositório>/actions/oidc/customization/sub --jq .sub_claim_prefix`.
     */
    subjectPrefix: z.string(),
    deployBranch: z.string().min(1),
  })
  .refine(
    ({ repository, subjectPrefix }) => {
      const [organization, name] = repository.split('/');
      return (
        subjectPrefix
          .match(/^repo:(.+)@\d+\/(.+)@\d+$/)
          ?.slice(1)
          .join('/') === `${organization}/${name}`
      );
    },
    { message: 'subjectPrefix precisa ser repo:<org>@<id>/<repo>@<id> do mesmo repositório.' },
  );

const configSchema = z.object({
  account: z.string().regex(/^\d{12}$/),
  region: z.string().min(1),
  domainName: z.string().min(1),
  github: githubSchema,
  staging: z.object({
    /** Fixa para o `cdk synth` não precisar consultar a conta. */
    availabilityZone: z.string().min(1),
    /** Fixa porque trocar a AMI substitui a instância, e com ela o disco (`infra/README.md`). */
    amiId: z.string().regex(/^ami-[0-9a-f]+$/),
    instanceType: z.string().min(1),
    diskSizeGb: z.number().int().positive(),
    webSubdomain: z.string().min(1),
    apiSubdomain: z.string().min(1),
    parameterPrefix: z.string().regex(/^(\/[\w.-]+)+$/),
    /** Expressão `cron(...)` do EventBridge Scheduler, no fuso America/Sao_Paulo. */
    autoStopCron: z.string().regex(/^cron\(.+\)$/),
  }),
});

export type SpaceSportsConfig = z.infer<typeof configSchema>;

/** Conta, região e demais valores vêm do contexto do `cdk.json`, não do código. */
export function loadConfig(node: Node): SpaceSportsConfig {
  return configSchema.parse(node.tryGetContext('spaceSports'));
}
