const { hairlineWidth } = require('nativewind/theme');
const { fontSize, fontWeight } = require('@space-sports/ui-tokens');

const tokenFontSizes = Object.fromEntries(
  Object.entries(fontSize).map(([name, { size, lineHeight }]) => [
    name,
    [`${size}px`, { lineHeight: `${lineHeight}px` }],
  ]),
);

const plugin = require('tailwindcss/plugin');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset'), require('@space-sports/ui-tokens').tailwindPreset],
  theme: {
    extend: {
      borderWidth: { hairline: hairlineWidth() },
      fontSize: tokenFontSizes,
      fontWeight: {
        normal: fontWeight.regular,
        medium: fontWeight.medium,
        semibold: fontWeight.semibold,
        bold: fontWeight.bold,
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    plugin(({ addUtilities }) => {
      addUtilities({
        '.font-medium': { fontFamily: 'InterMedium' },
        '.font-semibold': { fontFamily: 'InterSemiBold' },
        '.font-bold': { fontFamily: 'InterBold' },
        // Space Grotesk (`font-display` é o peso 400): no RN cada peso é uma família.
        '.font-display-medium': { fontFamily: 'SpaceGroteskMedium' },
        '.font-display-semibold': { fontFamily: 'SpaceGroteskSemiBold' },
        '.font-display-bold': { fontFamily: 'SpaceGroteskBold' },
      });
    }),
  ],
};
