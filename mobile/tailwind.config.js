/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#070a13',
        panel: '#0b1020',
        deep: '#090d19',
      },
    },
  },
  plugins: [],
};
