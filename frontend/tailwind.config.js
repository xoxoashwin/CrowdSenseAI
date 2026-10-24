/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        forest: {
          dark: '#37553A',
          darkHover: '#2A422D',
          muted: '#6B9071',
          light: '#AEC3B0',
          bg: '#AEC3B0',
          card: '#F7FAF6',
          sidebar: '#E8F0E8',
          text: '#263B2B',
          textMuted: '#627466',
          border: '#D4E0D5',
          input: '#FFFFFF',
          hover: '#DCE8DD',
          danger: '#C2413E',
          dangerBg: '#FDEAE9',
          dangerBorder: '#F5B7B5',
          warning: '#B26A00',
          warningBg: '#FFF6E5',
          warningBorder: '#F0CD8C',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'forest-card': '0 2px 6px -1px rgba(38, 59, 43, 0.05), 0 1px 3px -1px rgba(38, 59, 43, 0.03)',
        'forest-hover': '0 6px 14px -2px rgba(38, 59, 43, 0.08), 0 2px 5px -2px rgba(38, 59, 43, 0.04)',
      }
    },
  },
  plugins: [],
}
