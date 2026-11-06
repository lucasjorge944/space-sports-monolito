const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// Expo SDK 52+ já configura watchFolders e nodeModulesPaths para monorepos (pnpm incluso);
// pacotes do workspace (ex.: @space-sports/shared) resolvem via symlink em node_modules.
const config = getDefaultConfig(__dirname);

// Pacotes que precisam de um módulo só no bundle, senão o QueryClientProvider do app não chega aos
// hooks gerados do @space-sports/api-client: o pnpm resolve os dele pela versão do web (react
// 19.3.1), e o `require` do dist (CommonJS) pegaria a build `.cjs` em vez da ESM que o app importa.
const SINGLETONS = ['react', 'react-native', '@tanstack/react-query'];

const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const singleton = SINGLETONS.find(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );
  const nextContext = singleton
    ? { ...context, originModulePath: path.join(__dirname, 'package.json'), isESMImport: true }
    : context;
  return (resolveRequest ?? context.resolveRequest)(nextContext, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './src/global.css' });
