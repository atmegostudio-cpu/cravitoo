/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#FF5A1F',
          hover: '#E04815',
          active: '#C23B0F',
          light: '#FFE5DC',
        },
        accent: {
          DEFAULT: '#FACC15',
          hover: '#EAB308',
          light: '#FEFCE8',
        },
        background: '#F9FAFB',
        card: '#FFFFFF',
        'dark-sections': '#111827',
        'dark-card': '#1F2937',
        text: {
          primary: '#111111',
          secondary: '#4B5563',
          muted: '#9CA3AF',
          inverse: '#FFFFFF',
        },
        border: {
          light: '#E5E7EB',
          dark: '#374151',
        },
      },
      fontFamily: {
        heading: ['Outfit', 'sans-serif'],
        body: ['Work Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
}