import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseYaml } from './helpers.js';

const stagingDir = fileURLToPath(new URL('../staging', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const registry = '123456789012.dkr.ecr.sa-east-1.amazonaws.com';

/** Como a AWS CLI v2 imprime o `--query` do media-credentials.sh. */
const ASSUMED_CREDENTIALS = `{
    "Version": 1,
    "AccessKeyId": "ASIAEXEMPLO",
    "SecretAccessKey": "segredo",
    "SessionToken": "token-da-sessao",
    "Expiration": "2026-11-03T21:00:00+00:00"
}`;

const PARAMETERS = {
  api: [
    ['/space-sports/staging/api/DATABASE_URL', 'postgres://u:pa$$word@postgres:5432/db'],
    ['/space-sports/staging/api/BETTER_AUTH_SECRET', 'abc=="def'],
    ['/space-sports/staging/api/ADS_DELIVERY_SECRET', 'ads+secret/=='],
    ['/space-sports/staging/api/PAYMENTS_DATA_KEY', 'chave+dados/=='],
  ],
  postgres: [['/space-sports/staging/postgres/POSTGRES_PASSWORD', 'segredo']],
  seed: [['/space-sports/staging/seed/ALLOW_DEMO_SEED', 'true']],
};

let workDir: string;
let log: string;

/** `docker`, `aws` e `cloud-init` falsos: registram a chamada e falham quando o teste pede. */
function stub(name: string, body: string) {
  const path = join(workDir, 'bin', name);
  writeFileSync(path, `#!/usr/bin/env bash\necho "${name} $*" >> "$STUB_LOG"\n${body}\n`);
  chmodSync(path, 0o755);
}

function run(script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [join(workDir, 'site', script), ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${join(workDir, 'bin')}:${process.env.PATH}`,
      STUB_LOG: log,
      PARAMETERS_DIR: workDir,
      SYSTEMD_DIR: join(workDir, 'systemd'),
      ...env,
    },
  });
}

const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
const deploy = (env?: Record<string, string>) =>
  run('deploy.sh', [registry, 'abc123', '17-hash'], env);
const siteFile = (path: string) => join(workDir, 'site', path);

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'space-sports-deploy-'));
  log = join(workDir, 'calls.log');
  cpSync(stagingDir, join(workDir, 'site'), { recursive: true });
  mkdirSync(join(workDir, 'bin'));
  mkdirSync(join(workDir, 'systemd'));
  writeFileSync(join(workDir, 'assumed.json'), ASSUMED_CREDENTIALS);
  for (const [group, parameters] of Object.entries(PARAMETERS)) {
    writeFileSync(
      join(workDir, `${group}.tsv`),
      parameters.map((parameter) => `${parameter.join('\t')}\n`).join(''),
    );
  }
  stub('cloud-init', '');
  stub('systemctl', '');
  stub(
    'aws',
    `case "$*" in
  *get-parameters-by-path*) for g in api postgres seed; do
      case "$*" in *"/staging/$g "*) cat "$PARAMETERS_DIR/$g.tsv";; esac
    done;;
  *get-login-password*) echo token;;
  *get-caller-identity*) echo 123456789012;;
  *assume-role*) cat "$PARAMETERS_DIR/assumed.json"; exit "\${ASSUME_EXIT:-0}";;
esac`,
  );
  stub(
    'docker',
    `case "$*" in
  login*) cat > /dev/null;;
  *"run --rm -T migrate"*) exit "\${MIGRATE_EXIT:-0}";;
  *"up --detach --wait --wait-timeout 180 api web"*) exit "\${UP_EXIT:-0}";;
esac`,
  );
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('deploy.sh', () => {
  it('sobe os dados, migra e só então troca API e web', () => {
    const result = deploy();
    expect(result.status, result.stderr).toBe(0);

    const order = [
      'cloud-init status --wait',
      'aws sts assume-role',
      'docker compose up --detach --wait --wait-timeout 120 postgres redis',
      'docker compose run --rm -T migrate',
      'docker compose up --detach --wait --wait-timeout 180 api web',
      'docker compose up --detach --force-recreate caddy',
    ].map((call) => calls().indexOf(call));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('para se a migração falhar, sem trocar os serviços nem registrar a versão', () => {
    const result = deploy({ MIGRATE_EXIT: '1' });
    expect(result.status).not.toBe(0);
    expect(calls()).toContain('run --rm -T migrate');
    expect(calls()).not.toContain('api web');
    expect(calls()).not.toContain('caddy');
    expect(existsSync(siteFile('.env'))).toBe(false);
  });

  it('não registra a versão se a API não ficar saudável', () => {
    const result = deploy({ UP_EXIT: '1' });
    expect(result.status).not.toBe(0);
    expect(existsSync(siteFile('.env'))).toBe(false);
  });

  it('registra a versão no fim, sem segredos', () => {
    deploy();
    expect(readFileSync(siteFile('.env'), 'utf8')).toBe(
      `ECR_REGISTRY=${registry}\nIMAGE_TAG=abc123\nPOSTGRES_IMAGE_TAG=17-hash\n`,
    );
  });

  it('para antes de tudo se o bootstrap falhou, mas tolera erro recuperável do cloud-init', () => {
    stub('cloud-init', 'exit 1');
    const failed = deploy();
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('cloud-init-output.log');
    expect(calls()).not.toContain('docker');

    stub('cloud-init', 'exit 2');
    expect(deploy().status).toBe(0);
  });

  it('segue com um aviso se não conseguir as credenciais do papel de mídia', () => {
    const result = deploy({ ASSUME_EXIT: '254' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('upload de fotos vai falhar');
    expect(calls()).toContain('up --detach --wait --wait-timeout 180 api web');
    expect(existsSync(siteFile('.env'))).toBe(true);
  });

  it('descobre a região pelo registro do ECR', () => {
    stub('aws', 'echo "$AWS_DEFAULT_REGION" > "$PARAMETERS_DIR/region"; exit 1');
    deploy();
    expect(readFileSync(join(workDir, 'region'), 'utf8').trim()).toBe('sa-east-1');
  });
});

describe('apply-staging.sh', () => {
  const applyScript = join(repositoryRoot, 'infra/scripts/apply-staging.sh');

  /** `statusBody`: o trecho do `aws` falso que responde à consulta de estado. */
  const applyWith = (statusBody: string) => {
    stub('sleep', '');
    stub(
      'aws',
      `case "$*" in
  *send-command*)
    while [ "$1" != --parameters ]; do shift; done
    printf %s "$2" > "$PARAMETERS_DIR/parameters.json"
    echo command-id;;
  *"--query Status"*) ${statusBody};;
  *StandardOutputContent*) echo saida-do-deploy;;
  *StandardErrorContent*) echo erro-do-deploy;;
esac`,
    );
    return spawnSync('bash', [applyScript], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      // O `sleep` é falso: um script preso no laço giraria até o prazo real, de 24 minutos.
      timeout: 10_000,
      env: {
        PATH: `${join(workDir, 'bin')}:${process.env.PATH}`,
        STUB_LOG: log,
        PARAMETERS_DIR: workDir,
        INSTANCE_ID: 'i-123',
        ECR_REGISTRY: registry,
        IMAGE_TAG: 'abc123',
        POSTGRES_IMAGE_TAG: '17-hash',
      },
    });
  };
  const apply = (status: string) => applyWith(`echo "${status}"`);
  const sentParameters = () => JSON.parse(readFileSync(join(workDir, 'parameters.json'), 'utf8'));

  it('termina bem quando o comando termina bem, e mostra a saída do servidor', () => {
    const result = apply('Success');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('saida-do-deploy');
    expect(result.stderr).toContain('erro-do-deploy');
  });

  it.each(['Failed', 'TimedOut', 'Cancelled'])('falha se o comando terminar em %s', (status) => {
    expect(apply(status).status).toBe(1);
  });

  it('espera enquanto a invocação ainda não existe', () => {
    const result = applyWith(`
      count=$(cat "$PARAMETERS_DIR/polls" 2>/dev/null || echo 0)
      echo $((count + 1)) > "$PARAMETERS_DIR/polls"
      if [ "$count" -lt 2 ]; then
        echo 'An error occurred (InvocationDoesNotExist) when calling GetCommandInvocation' >&2
        exit 254
      fi
      echo Success`);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(workDir, 'polls'), 'utf8').trim()).toBe('3');
  });

  it.each(['AccessDeniedException', 'InvalidInstanceId', 'ThrottlingException'])(
    'para no primeiro erro %s, sem esperar o prazo',
    (error) => {
      const result = applyWith(`
        echo "An error occurred (${error}) when calling GetCommandInvocation" >&2
        exit 254`);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(error);
      expect(result.stdout).toContain('pode seguir rodando no servidor');
      expect(calls().match(/--query Status/g)).toHaveLength(1);
    },
  );

  it('o comando enviado extrai os arquivos e chama o deploy com a versão', () => {
    apply('Success');
    const { commands, executionTimeout } = sentParameters();
    expect(executionTimeout).toEqual(['1200']);
    expect(commands.at(-1)).toBe(`bash deploy.sh '${registry}' 'abc123' '17-hash'`);

    const target = join(workDir, 'extracted');
    mkdirSync(target);
    const extract = spawnSync('bash', ['-c', commands[2]], { cwd: target, encoding: 'utf8' });
    expect(extract.status, extract.stderr).toBe(0);
    expect(readdirSync(target).sort()).toEqual([
      'Caddyfile',
      'compose.yml',
      'deploy.sh',
      'fetch-env.sh',
      'media-credentials.sh',
    ]);
    expect(readFileSync(join(target, 'compose.yml'), 'utf8')).toBe(
      readFileSync(join(stagingDir, 'compose.yml'), 'utf8'),
    );
  });

  it('o pacote enviado fica bem abaixo do limite de 64 KB de um documento do SSM', () => {
    apply('Success');
    expect(JSON.stringify(sentParameters()).length).toBeLessThan(16_000);
  });
});

describe('passo que confere as imagens no workflow', () => {
  const workflow = parseYaml('github-workflows-desativados/deploy-staging.yml');
  const step = workflow.jobs.deploy.steps.find((s: { id?: string }) => s.id === 'images');

  /** Roda o `run:` real, como o GitHub roda: `bash -e`. */
  const runStep = (awsBody: string) => {
    stub('aws', awsBody);
    const output = join(workDir, 'github-output');
    const result = spawnSync('bash', ['-e', '-c', step.run], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        PATH: `${join(workDir, 'bin')}:${process.env.PATH}`,
        STUB_LOG: log,
        IMAGE_TAG: 'abc123',
        GITHUB_OUTPUT: output,
        GITHUB_ENV: join(workDir, 'github-env'),
      },
    });
    return { ...result, outputs: existsSync(output) ? readFileSync(output, 'utf8') : '' };
  };
  const awsError = (name: string) =>
    `echo 'An error occurred (${name}) when calling the DescribeImages operation' >&2; exit 254`;

  it('pula o que já está publicado', () => {
    const { status, outputs } = runStep('echo "{}"');
    expect(status).toBe(0);
    expect(outputs).toBe('api=published\nweb=published\npostgres=published\n');
  });

  it('constrói só o que falta', () => {
    const { status, outputs } = runStep(
      `case "$*" in *space-sports/web*) ${awsError('ImageNotFoundException')};; esac`,
    );
    expect(status).toBe(0);
    expect(outputs).toBe('api=published\nweb=missing\npostgres=published\n');
  });

  it.each(['AccessDeniedException', 'RepositoryNotFoundException', 'ExpiredTokenException'])(
    'falha com %s, em vez de tratar como imagem ausente',
    (error) => {
      const { status, stderr, outputs } = runStep(awsError(error));
      expect(status).not.toBe(0);
      expect(stderr).toContain(error);
      expect(outputs).not.toContain('=missing');
    },
  );
});

describe('fetch-env.sh', () => {
  it('grava os valores literais, só para o root', () => {
    expect(run('fetch-env.sh', []).status).toBe(0);
    const api = readFileSync(siteFile('env/api.env'), 'utf8');
    expect(api).toContain('DATABASE_URL=postgres://u:pa$$word@postgres:5432/db\n');
    expect(api).toContain('BETTER_AUTH_SECRET=abc=="def\n');
    expect(api).toContain('ADS_DELIVERY_SECRET=ads+secret/==\n');
    expect(statSync(siteFile('env/api.env')).mode & 0o777).toBe(0o600);
    expect(statSync(siteFile('env')).mode & 0o777).toBe(0o700);
  });

  it('o env da API não recebe o que é do seed', () => {
    run('fetch-env.sh', []);
    expect(readFileSync(siteFile('env/api.env'), 'utf8')).not.toContain('ALLOW_DEMO_SEED');
    expect(readFileSync(siteFile('env/seed.env'), 'utf8')).toBe('ALLOW_DEMO_SEED=true\n');
  });

  it('para com uma mensagem clara se faltar um parâmetro obrigatório', () => {
    writeFileSync(join(workDir, 'postgres.tsv'), '');
    const result = run('fetch-env.sh', []);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('/space-sports/staging/postgres/POSTGRES_PASSWORD');
  });

  it('para se o Parameter Store falhar', () => {
    stub('aws', 'exit 254');
    expect(run('fetch-env.sh', []).status).not.toBe(0);
  });
});

describe('media-credentials.sh', () => {
  const credentials = () => readFileSync(siteFile('aws/media.json'), 'utf8');
  const unit = (name: string) =>
    readFileSync(join(workDir, 'systemd', `space-sports-media-credentials.${name}`), 'utf8');

  it('assume o papel de mídia por 1 hora, com o papel da instância', () => {
    const result = run('media-credentials.sh', []);
    expect(result.status, result.stderr).toBe(0);
    const assume = calls()
      .split('\n')
      .find((line) => line.includes('assume-role'));
    expect(assume).toContain(
      '--role-arn arn:aws:iam::123456789012:role/space-sports-staging-media ',
    );
    expect(assume).toContain('--duration-seconds 3600 ');
    expect(assume).toContain('{Version: `1`, AccessKeyId: Credentials.AccessKeyId,');
    expect(assume).toContain('--output json');
  });

  it('grava as credenciais no formato do credential_process, legíveis pelo usuário do contêiner', () => {
    run('media-credentials.sh', []);
    expect(JSON.parse(credentials())).toEqual({
      Version: 1,
      AccessKeyId: 'ASIAEXEMPLO',
      SecretAccessKey: 'segredo',
      SessionToken: 'token-da-sessao',
      Expiration: '2026-11-03T21:00:00+00:00',
    });
    expect(statSync(siteFile('aws/media.json')).mode & 0o777).toBe(0o644);
    expect(statSync(siteFile('aws')).mode & 0o777).toBe(0o755);
    expect(readdirSync(siteFile('aws')).sort()).toEqual(['config', 'media.json']);
  });

  it('aponta o SDK para o arquivo, pelo caminho de dentro do contêiner', () => {
    run('media-credentials.sh', []);
    expect(readFileSync(siteFile('aws/config'), 'utf8')).toBe(
      '[default]\ncredential_process = cat /run/aws/media.json\n',
    );
  });

  it('se o assume-role falhar, mantém as credenciais anteriores e não deixa temporário', () => {
    run('media-credentials.sh', []);
    const previous = credentials();

    expect(run('media-credentials.sh', [], { ASSUME_EXIT: '254' }).status).not.toBe(0);
    writeFileSync(join(workDir, 'assumed.json'), '');
    expect(run('media-credentials.sh', []).status).not.toBe(0);

    expect(credentials()).toBe(previous);
    expect(readdirSync(siteFile('aws')).sort()).toEqual(['config', 'media.json']);
  });

  it('install liga o serviço no boot, antes do Docker, e o timer de renovação', () => {
    const result = run('media-credentials.sh', ['install']);
    expect(result.status, result.stderr).toBe(0);

    const service = unit('service');
    expect(service).toContain('Before=docker.service\n');
    expect(service).toContain('After=network-online.target\n');
    expect(service).toContain('Type=oneshot\n');
    expect(service).toContain(`ExecStart=/usr/bin/bash ${siteFile('media-credentials.sh')}\n`);
    expect(service).toContain('WantedBy=multi-user.target\n');

    expect(calls()).toContain('systemctl daemon-reload');
    expect(calls()).toContain(
      'systemctl enable space-sports-media-credentials.service space-sports-media-credentials.timer',
    );
    expect(calls()).toContain('systemctl start space-sports-media-credentials.timer');
    expect(existsSync(siteFile('aws/media.json'))).toBe(true);
  });

  it('renova bem antes de expirar: o SDK relê 5 minutos antes do fim', () => {
    run('media-credentials.sh', ['install']);
    const timer = unit('timer');
    const minutes = (key: string) =>
      Number(timer.match(new RegExp(`^${key}=(\\d+)min$`, 'm'))?.[1]);
    const duration = Number(
      readFileSync(siteFile('media-credentials.sh'), 'utf8').match(
        /^SESSION_DURATION=(\d+)$/m,
      )?.[1],
    );
    expect(minutes('OnUnitActiveSec')).toBeGreaterThan(0);
    expect(minutes('OnBootSec')).toBeGreaterThan(0);
    // Mesmo com uma renovação perdida, o arquivo ainda vale mais de 5 minutos quando o SDK relê.
    expect(duration / 60 - 2 * minutes('OnUnitActiveSec')).toBeGreaterThan(5);
  });

  it('recusa um modo desconhecido', () => {
    expect(run('media-credentials.sh', ['instalar']).status).toBe(2);
  });
});
