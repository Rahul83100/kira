/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#e0fff9',
          100: '#b3fff0',
          200: '#80ffe5',
          300: '#4dffd9',
          400: '#1affcc',
          500: '#00ffd5',
          600: '#00e6c0',
          700: '#00bf9f',
          800: '#00997e',
          900: '#00735f',
        },
        accent: {
          50: '#fff0f4',
          100: '#ffd6e0',
          200: '#ffb3c2',
          300: '#ff809a',
          400: '#ff4d73',
          500: '#ff3e6c',
          600: '#e63861',
          700: '#bf2e51',
          800: '#992541',
          900: '#731c31',
        },
      },
    },
  },
  plugins: [],
}
