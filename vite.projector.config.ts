import { defineConfig } from 'vite';
import path from 'path';

// Vite config for the projector window
// Uses projector.html as the entry point instead of index.html
export default defineConfig(async () => {
    const react = await import('@vitejs/plugin-react');
    return {
        plugins: [react.default()],
        build: {
            rollupOptions: {
                input: path.resolve(__dirname, 'projector.html'),
            },
        },
    };
});

