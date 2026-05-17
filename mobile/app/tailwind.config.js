/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    fontSize: {
      'xxs': ['var(--ts-xxs, 10px)', { lineHeight: 'var(--lh-xxs, 14px)' }],
      'xs':  ['var(--ts-xs, 12px)',  { lineHeight: 'var(--lh-xs, 16px)' }],
      'sm':  ['var(--ts-sm, 14px)',  { lineHeight: 'var(--lh-sm, 20px)' }],
      'base':['var(--ts-base, 16px)',{ lineHeight: 'var(--lh-base, 24px)' }],
      'lg':  ['var(--ts-lg, 18px)',  { lineHeight: 'var(--lh-lg, 28px)' }],
      'xl':  ['var(--ts-xl, 20px)',  { lineHeight: 'var(--lh-xl, 28px)' }],
      '2xl': ['var(--ts-2xl, 24px)', { lineHeight: 'var(--lh-2xl, 32px)' }],
      '3xl': ['var(--ts-3xl, 30px)', { lineHeight: 'var(--lh-3xl, 36px)' }],
    },
    extend: {},
  },
  plugins: [],
};
