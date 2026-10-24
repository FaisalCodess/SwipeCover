/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#0b0f14',
        mint: '#7ce8b9',
      },
      boxShadow: {
        glow: '0 0 36px rgba(124, 232, 185, 0.13)',
      },
    },
  },
  plugins: [],
};
