/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        orange: '#FF6B35',
        navy: '#0F1B2D',
        ink: '#0a0f1c',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Inter Black"', 'Inter', 'system-ui', 'sans-serif'],
        script: ['"Aston Script"', 'cursive'],
      },
    },
  },
  plugins: [],
};
