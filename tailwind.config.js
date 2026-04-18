/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        env: {
          dev: 'hsl(var(--env-dev))',
          staging: 'hsl(var(--env-staging))',
          prod: 'hsl(var(--env-prod))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'glow-primary': '0 0 0 3px hsl(var(--primary) / 0.18)',
        'glow-destructive': '0 0 0 3px hsl(var(--destructive) / 0.18)',
        soft: '0 1px 2px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.15)',
        lift: '0 10px 24px -12px rgba(0,0,0,0.5), 0 4px 10px -4px rgba(0,0,0,0.3)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-down': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-out-right': {
          from: { opacity: '1', transform: 'translateX(0)' },
          to: { opacity: '0', transform: 'translateX(16px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'ping-soft': {
          '0%': { transform: 'scale(1)', opacity: '0.7' },
          '75%, 100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        'toast-progress': {
          from: { transform: 'scaleX(1)' },
          to: { transform: 'scaleX(0)' },
        },
        glow: {
          '0%, 100%': { boxShadow: '0 0 0 0 hsl(var(--primary) / 0.35)' },
          '50%': { boxShadow: '0 0 0 6px hsl(var(--primary) / 0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out both',
        'fade-in-up': 'fade-in-up 220ms ease-out both',
        'fade-in-down': 'fade-in-down 220ms ease-out both',
        'scale-in': 'scale-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both',
        'slide-in-right': 'slide-in-right 240ms cubic-bezier(0.2, 0.9, 0.3, 1.05) both',
        'slide-out-right': 'slide-out-right 200ms ease-in both',
        shimmer: 'shimmer 1.6s linear infinite',
        'ping-soft': 'ping-soft 1.8s cubic-bezier(0, 0, 0.2, 1) infinite',
        'spin-slow': 'spin-slow 2.4s linear infinite',
        'toast-progress': 'toast-progress 4.5s linear forwards',
        glow: 'glow 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
