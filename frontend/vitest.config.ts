import {defineConfig, mergeConfig} from 'vitest/config';
import viteConfig from './vite.config';
// The separate avatar-experience package uses node:test and owns its own runner.
export default mergeConfig(viteConfig, defineConfig({test:{include:['src/**/*.test.{ts,tsx}']}}));
