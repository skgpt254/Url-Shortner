import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Lets the dev server call the API at a relative path (/api/...)
      // without CORS ever entering the picture locally — matches how the
      // production nginx config also proxies /api (see frontend/nginx.conf),
      // so the frontend code never needs an environment-specific base URL.
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
