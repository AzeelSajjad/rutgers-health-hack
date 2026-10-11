/** Synchronize public Auth0 settings without storing tokens or client secrets. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{audience:{type:'string'},faculty:{type:'string'},issuer:{type:'string',default:'https://dev-ytzdso55lpgvuxwq.us.auth0.com/'}}});
if(!values.audience?.trim() || /[\r\n]/.test(values.audience) || values.audience.length>2048)throw new Error('Provide the exact Auth0 API Identifier using --audience.');
const issuer=new URL(values.issuer!);
if(issuer.protocol!=='https:' || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname!=='/')throw new Error('Use the Auth0 tenant HTTPS origin with a trailing slash.');
if(values.faculty && !values.faculty.split(',').every(id=>/^[a-zA-Z0-9_-]+\|[^\s,=]+$/.test(id)))throw new Error('Faculty IDs must be Auth0 user subjects, not usernames.');
function update(relative:string,updates:Record<string,string>) {
  const path=fileURLToPath(new URL(relative,import.meta.url));
  let text=existsSync(path)?readFileSync(path,'utf8'):'';
  for(const [key,value] of Object.entries(updates)) {
    const line=`${key}=${value}`;
    const pattern=new RegExp(`^${key}=.*$`,'m');
    text=pattern.test(text)?text.replace(pattern,()=>line):text.trimEnd()+'\n'+line+'\n';
  }
  writeFileSync(path,text);
}
update('../.env',{AUTH0_ISSUER_BASE_URL:issuer.href,AUTH0_AUDIENCE:values.audience,...(values.faculty?{FACULTY_SUBJECTS:values.faculty}:{})});
update('../../frontend/.env',{VITE_AUTH0_DOMAIN:issuer.hostname,VITE_AUTH0_AUDIENCE:values.audience});
console.log('Updated ignored backend/.env and frontend/.env with matching Auth0 settings. Restart both servers. No credentials or tokens were saved.');
