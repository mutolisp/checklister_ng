import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const API_BASE_URL = env.VITE_API_BASE_URL || '/api';

  return {
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
      proxy: API_BASE_URL.startsWith('http')
        ? { '/api': API_BASE_URL }
        : undefined
    },
    define: {
      __API_BASE_URL__: JSON.stringify(API_BASE_URL)
    }
  };
});

