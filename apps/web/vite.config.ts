import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

function siteVerificationPlugin(): Plugin {
  return {
    name: 'inject-google-site-verification',
    transformIndexHtml(html) {
      const token = (process.env.VITE_GOOGLE_SITE_VERIFICATION || '').trim();
      if (!/^[a-zA-Z0-9_-]{10,120}$/.test(token)) return html;
      return html.replace(
        '</head>',
        `    <meta name="google-site-verification" content="${token}" />\n  </head>`
      );
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    siteVerificationPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/sitemap\.xml$/, /^\/robots\.txt$/],
      },
      includeAssets: [
        'favicon.ico',
        'favicon.png',
        'apple-icon.png',
        'logo.png',
        'logo-landscape.png',
        'logo-symbol.png',
        'icon-512.png',
      ],
      manifest: false // We already have a static manifest in public/manifest.webmanifest
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
