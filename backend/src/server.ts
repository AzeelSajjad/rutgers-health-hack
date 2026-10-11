import { config } from './config.js';
import { createDeps } from './deps.js';
import { authSettings } from './security/auth.js';
import { createEncounterServer } from './serverFactory.js';

const host = process.env.HOST ?? (config.fakeAws ? '127.0.0.1' : '0.0.0.0');
const auth = authSettings(process.env, host);
const app = createEncounterServer(createDeps(), { allowedOrigins: config.allowedOrigins, ...auth });
await app.listen({ port: config.port, host });
