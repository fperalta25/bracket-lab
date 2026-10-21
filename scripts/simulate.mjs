import { createServer } from 'vite';

// Development harness only; uses the existing Vite TypeScript loader, no new dependency.
const server = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
try {
    const { benchmark } = await server.ssrLoadModule('/scripts/simulate.ts');
    benchmark(Number(process.argv[2] ?? 1000), Number(process.argv[3] ?? 2026));
} finally {
    await server.close();
}
