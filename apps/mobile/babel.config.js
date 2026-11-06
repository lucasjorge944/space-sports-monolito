// O `nativewind/babel` (react-native-css-interop) devolve plugins por nome, e o Babel os resolve a
// partir desta pasta: todos precisam estar no package.json do app. É o caso do
// `@babel/plugin-transform-react-jsx`. O `react-native-reanimated/plugin` já é dependência.
// Localmente o `npx expo` acharia mesmo sem declarar, pelo NODE_PATH que o pnpm põe em
// `node_modules/.bin`. O Gradle do EAS chama o CLI direto e falharia. Ver src/babel-config.test.ts.
module.exports = (api) => {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
