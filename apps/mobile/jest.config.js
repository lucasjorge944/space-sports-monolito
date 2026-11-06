module.exports = {
  preset: 'jest-expo',
  // Sem limite o Jest sobe um worker por núcleo, de cerca de 700 MB cada, e esgota a RAM da máquina.
  maxWorkers: 2,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // O campo "react-native" do lucide aponta para .mjs, que o Jest não transforma: usa o build CJS.
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|@rn-primitives[/+].*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|nativewind|react-native-css-interop|lucide-react-native|standard-navigation))',
  ],
};
