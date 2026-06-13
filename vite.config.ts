import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

function reactDevtools(): Plugin {
  return {
    name: "react-devtools",
    apply: "serve",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { src: "http://localhost:8097" },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    reactDevtools(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/pdfjs-dist/cmaps/*",
          dest: "pdfjs/cmaps",
        },
        {
          src: "node_modules/pdfjs-dist/standard_fonts/*",
          dest: "pdfjs/standard_fonts",
        },
      ],
    }),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
