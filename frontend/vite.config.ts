import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, 'src/lib'),
      $stores: path.resolve(__dirname, 'src/stores')
    }
  },
  optimizeDeps: {
    include: ['flowbite', 'flowbite-svelte'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000'
    }
  }
});

