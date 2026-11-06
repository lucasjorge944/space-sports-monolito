import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { parse } from 'yaml';
import { defineStacks } from '../lib/app.js';

const infraFile = (path: string) => new URL(`../${path}`, import.meta.url);

/** O contexto real do `cdk.json`: os testes conferem o que vai para a conta. */
export const cdkContext = JSON.parse(readFileSync(infraFile('cdk.json'), 'utf8')).context;

export const readInfraFile = (path: string) => readFileSync(infraFile(path), 'utf8');

/** `merge`: o compose usa `<<:`. */
export const parseYaml = (path: string) => parse(readInfraFile(path), { merge: true });

export function synthesize() {
  const { shared, staging } = defineStacks(new App({ context: cdkContext }));
  return { shared: Template.fromStack(shared), staging: Template.fromStack(staging) };
}
