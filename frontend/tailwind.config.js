/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Stops hover styles from sticking after a tap on touch screens.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', '"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#0b0f14',
        mint: '#7ce8b9',
        // Theme-aware tokens, defined in index.css and swapped by `.light-theme`.
        fg: token('fg'),
        soft: token('fg-soft'),
        muted: token('fg-muted'),
        faint: token('fg-faint'),
        line: token('line'),
        accent: token('accent'),
        warn: token('warn'),
      },
      boxShadow: {
        glow: '0 0 36px rgba(124, 232, 185, 0.13)',
      },
    },
  },
  plugins: [],
};
