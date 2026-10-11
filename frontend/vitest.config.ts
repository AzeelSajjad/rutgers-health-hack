import {defineConfig, mergeConfig} from 'vitest/config';
import viteConfig from './vite.config';
// All frontend suites run in the unified React workspace.
export default mergeConfig(viteConfig, defineConfig({test:{include:['src/**/*.test.{ts,tsx}']}}));
