/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ["'Cormorant Garamond'", "serif"],
        sans:  ["Inter", "sans-serif"],
      },
      colors: {
        // AFS Design Tokens — match the original app exactly
        afs: {
          bg:    "#07070f",
          card:  "#0d0d18",
          bdr:   "#181828",
          gold:  "#c4a030",
          goldL: "#d4b050",
          mute:  "#3a3a52",
          dim:   "#5a5a72",
          text:  "#e0dcd0",
          sub:   "#b8b4a8",
        },
      },
      animation: {
        'fade-up':  'fadeUp 0.3s ease',
        'spin-slow':'spin 0.8s linear infinite',
        'glow':     'glow 2.5s ease infinite',
        'shake':    'shake 0.3s ease',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        glow: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.35' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%':      { transform: 'translateX(-8px)' },
          '75%':      { transform: 'translateX(8px)' },
        },
      },
      maxWidth: {
        'app': '860px',
      },
    },
  },
  plugins: [],
}
