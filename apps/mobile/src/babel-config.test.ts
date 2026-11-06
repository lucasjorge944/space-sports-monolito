import { execFileSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '..');

/**
 * Carrega o `babel.config.js` como o bundle de release do Gradle carrega: num processo Node sem o
 * `NODE_PATH` que o atalho do pnpm em `node_modules/.bin` define (é ele que deixa o `npx expo` e o
 * Jest acharem pacotes içados em `node_modules/.pnpm/node_modules`). O Babel resolve os plugins que
 * um preset devolve por nome a partir da pasta do `babel.config.js`, então cada um deles precisa
 * estar declarado no `package.json` do app (ex.: `@babel/plugin-transform-react-jsx`, do
 * `nativewind/babel`).
 */
function loadBabelPlugins(platform: 'android' | 'ios', isDev: boolean): string[] {
  const script = `
    const path = require('node:path');
    const root = process.argv[1];
    const expo = require.resolve('expo/package.json', { paths: [root] });
    const metroConfig = require.resolve('@expo/metro-config', { paths: [path.dirname(expo)] });
    const babel = require(require.resolve('@babel/core', { paths: [path.dirname(metroConfig)] }));
    const options = babel.loadOptions({
      filename: path.join(root, 'src/app/_layout.tsx'),
      cwd: root,
      root,
      babelrc: false,
      configFile: false,
      extends: path.join(root, 'babel.config.js'),
      envName: process.argv[3] === 'true' ? 'development' : 'production',
      caller: {
        name: 'metro',
        bundler: 'metro',
        platform: process.argv[2],
        isDev: process.argv[3] === 'true',
        engine: 'hermes',
        supportsStaticESM: true,
        projectRoot: root,
      },
    });
    process.stdout.write(JSON.stringify(options.plugins.map((plugin) => plugin.key)));
  `;
  const env = { ...process.env };
  delete env.NODE_PATH;
  const output = execFileSync(
    process.execPath,
    ['-e', script, projectRoot, platform, String(isDev)],
    { cwd: projectRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(output) as string[];
}

describe('babel.config.js sem o NODE_PATH do pnpm (bundle do EAS)', () => {
  it.each([
    ['android', false],
    ['ios', false],
    ['android', true],
  ] as const)('resolve todos os plugins (%s, dev=%s)', (platform, isDev) => {
    const plugins = loadBabelPlugins(platform, isDev);
    expect(plugins).toContain('transform-react-jsx');
    expect(plugins.length).toBeGreaterThan(20);
  });
});
