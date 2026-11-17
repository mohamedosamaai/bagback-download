import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

function headInjectionPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'inject-head-tags',
    transformIndexHtml(html) {
      let injected = '';

      const verificationToken = (env.VITE_GOOGLE_SITE_VERIFICATION || process.env.VITE_GOOGLE_SITE_VERIFICATION || '').trim();
      if (/^[a-zA-Z0-9_-]{10,120}$/.test(verificationToken)) {
        injected += `    <meta name="google-site-verification" content="${verificationToken}" />\n`;
      }

      const tagSrc = (env.VITE_MONETAG_TAG_SRC || process.env.VITE_MONETAG_TAG_SRC || '').trim();
      const tagZone = (env.VITE_MONETAG_TAG_ZONE || process.env.VITE_MONETAG_TAG_ZONE || '').trim();
      if (/^https:\/\/[a-z0-9.-]+\/[a-zA-Z0-9_.\/-]+$/.test(tagSrc) && /^[0-9a-zA-Z_-]{1,32}$/.test(tagZone)) {
        injected += `    <script src="${tagSrc}" data-zone="${tagZone}" async data-cfasync="false"></script>\n`;
      }

      if (!injected) return html;
      return html.replace('</head>', `${injected}  </head>`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      headInjectionPlugin(env),
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
  };
});
