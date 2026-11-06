import { type App, Tags } from 'aws-cdk-lib';
import { loadConfig } from './config.js';
import { SharedStack } from './shared-stack.js';
import { StagingStack } from './staging-stack.js';

/** Declara as stacks. O `bin/` e os testes passam por aqui, então testam a mesma montagem. */
export function defineStacks(app: App) {
  const config = loadConfig(app.node);
  const env = { account: config.account, region: config.region };

  const shared = new SharedStack(app, 'SpaceSportsShared', { env, config });
  const staging = new StagingStack(app, 'SpaceSportsStaging', { env, config, shared });

  Tags.of(app).add('project', 'space-sports');
  Tags.of(staging).add('environment', 'staging');
  return { shared, staging };
}
