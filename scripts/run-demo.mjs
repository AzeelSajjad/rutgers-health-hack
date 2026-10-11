/** Start one frontend and one encounter backend; never run the standalone voice server alongside it. */
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const vitePackage=require.resolve('vite/package.json');
const viteBin=join(dirname(vitePackage),require('vite/package.json').bin.vite);
const backend=fileURLToPath(new URL('../backend/',import.meta.url));
const frontend=fileURLToPath(new URL('../frontend/',import.meta.url));
const preview=process.argv.includes('--preview');
const local=process.argv.includes('--local');
if(preview && local)throw new Error('Choose either --preview or --local.');
const readEnv=path=>existsSync(path)?parseEnv(readFileSync(path,'utf8')):{};
const backendEnv={...readEnv(backend+'.env'),...process.env};
const frontendEnv={...readEnv(frontend+'.env'),...process.env};
const port=Number(process.env.DEMO_PORT||5173);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('DEMO_PORT must be an integer between 1024 and 65535.');
if(!preview) {
  if(!local) {
  if(!backendEnv.AUTH0_AUDIENCE || frontendEnv.VITE_AUTH0_AUDIENCE!==backendEnv.AUTH0_AUDIENCE || !(backendEnv.AUTH0_ISSUER_BASE_URL||backendEnv.AUTH0_DOMAIN)) {
    console.error("Configure the matching Auth0 API Identifier first:\nnpm run configure:auth --workspace backend -- --audience 'YOUR_API_IDENTIFIER'\nSee frontend/AUTH0_SETUP.md. For the scripted UI only: npm run demo -- --preview");
    process.exit(1);
  }
  }
  if(!backendEnv.SESSION_TABLE_NAME || !backendEnv.TRANSCRIPT_BUCKET_NAME)throw new Error('Deploy storage first and configure backend/.env.');
}
const origins=[`http://localhost:${port}`,`http://127.0.0.1:${port}`];
const services=[];
let stopping=false;
const stop=(code=0)=>{
  if(stopping)return;stopping=true;
  for(const child of services)child.kill('SIGTERM');
  process.exitCode=code;setTimeout(()=>process.exit(code),300);
};
const launch=(args,cwd,env)=>{
  const child=spawn(process.execPath,args,{cwd,env,stdio:'inherit'});services.push(child);
  child.on('error',error=>{console.error(error.message);stop(1);});
  child.on('exit',code=>{if(!stopping)stop(code??1);});
};
launch(['--import','tsx','src/server.ts'],backend,{...backendEnv,HOST:'127.0.0.1',PORT:'3001',ALLOWED_ORIGINS:[...new Set([...origins,...(backendEnv.ALLOWED_ORIGINS||'').split(',').filter(Boolean)])].join(','),FAKE_AWS:preview?'1':'0',LOCAL_DEMO_AUTH:local?'1':'0',...(preview||local?{AUTH0_DOMAIN:'',AUTH0_ISSUER_BASE_URL:'',AUTH0_AUDIENCE:''}:{})});
launch([viteBin,'--host','127.0.0.1','--port',String(port),'--strictPort'],frontend,{...frontendEnv,ENCOUNTER_BACKEND_URL:'http://127.0.0.1:3001',VITE_LOCAL_DEMO_AUTH:local?'1':'0',...(preview||local?{VITE_AUTH0_DOMAIN:'YOUR_AUTH0_DOMAIN',VITE_AUTH0_CLIENT_ID:'YOUR_AUTH0_CLIENT_ID'}:{})});
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
console.log(`Open http://localhost:${port}/. ${preview?'Scripted preview; choose Preview on the landing page.':local?'Local student demo: real AWS services, Auth0 disabled, faculty routes remain protected.':'Signed-in live AWS encounters and authorized faculty review.'}`);
