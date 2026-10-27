import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { encode, decode, makeSnapshot, normalizeQuery } from './supabase-data.mjs';

let sb, config;
const authState={currentUser:null};
const observers=new Set(), listeners=new Set(), rtHandlers=new Map(), presenceWrites=new Map();
const connectionId=crypto.randomUUID();
let socket, refreshTimer, authGeneration=0, connected=false;
const SITE_URL='https://meltedsnowman2012.github.io/robofest2027/';
function fail(error){ if(error)throw Object.assign(new Error(error.message||'Supabase 요청 실패'),{code:error.code||error.status}); }
function report(error){ window.dispatchEvent(new CustomEvent('nextbot-backend-error',{detail:{message:error.message||String(error)}})); }
export function initializeApp(settings){
 config=settings;
 sb=createClient(settings.url,settings.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 sb.auth.onAuthStateChange((event,session)=>{
   if(event==='PASSWORD_RECOVERY')setTimeout(()=>window.dispatchEvent(new Event('nextbot-password-recovery')),0);
   if(event==='TOKEN_REFRESHED')return;
   const generation=++authGeneration;
   setTimeout(()=>hydrate(session?.user,generation).catch(report),0);
 });
 return {supabase:sb};
}
async function hydrate(user,generation){
 if(!user){
   stopLive();authState.currentUser=null;
   for(const fn of observers)Promise.resolve(fn(null)).catch(report);
   return;
 }
 const {data,error}=await sb.rpc('nb_identity');
 if(generation!==authGeneration)return;
 if(error){stopLive();authState.currentUser=null;for(const fn of observers)Promise.resolve(fn(null)).catch(report);report(error);return;}
 const old=authState.currentUser;
 authState.currentUser={uid:data.uid,email:user.email,displayName:data.nickname,photoURL:data.photoURL,team:data.team,authId:user.id};
 startLive();
 if(!old||old.uid!==data.uid)for(const fn of observers)Promise.resolve(fn(authState.currentUser)).catch(report);
}
export const getAuth=()=>authState;
export const getFirestore=()=>({kind:'database'});
export const getDatabase=()=>({kind:'realtime'});
export function onAuthStateChanged(_auth,callback){
 observers.add(callback);
 if(authState.currentUser)queueMicrotask(()=>Promise.resolve(callback(authState.currentUser)).catch(report));
 return ()=>observers.delete(callback);
}
export async function signUpMember(email,password,nickname){
 const {data,error}=await sb.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:SITE_URL,data:{nickname}}});
 fail(error);return data;
}
export async function createUserWithEmailAndPassword(_auth,email,password){const r=await signUpMember(email,password,'');return {user:r.user};}
export async function signInWithEmailAndPassword(_auth,email,password){const {data,error}=await sb.auth.signInWithPassword({email:email.trim(),password});fail(error);return data;}
export async function signOut(){const {error}=await sb.auth.signOut();fail(error);}
export async function sendPasswordResetEmail(_auth,email){const {error}=await sb.auth.resetPasswordForEmail(email.trim(),{redirectTo:SITE_URL});fail(error);}
export async function completePasswordReset(password){const {data,error}=await sb.auth.updateUser({password});fail(error);return data;}
export async function updateProfile(user,patch){
 if(patch.displayName||patch.photoURL)await updateDoc(doc(getFirestore(),'users',user.uid),{...(patch.displayName?{nickname:patch.displayName}:{}),...(patch.photoURL?{photoURL:patch.photoURL}:{})});
}
export const browserLocalPersistence='local';
export async function setPersistence(){}

function pathOf(base,parts){return [base?.path,...parts].filter(v=>v!==undefined&&v!==null&&v!=='').join('/');}
export const doc=(base,...parts)=>({kind:'doc',path:pathOf(base,parts),id:String(parts.at(-1)||base?.id||'')});
export const collection=(base,...parts)=>({kind:'collection',path:pathOf(base,parts)});
export const where=(field,op,value)=>({type:'where',field,op,value});
export const orderBy=(field,direction='asc')=>({type:'order',field,direction});
export const limit=count=>({type:'limit',count});
export const query=(base,...clauses)=>({...base,clauses:[...(base.clauses||[]),...clauses]});
export const serverTimestamp=()=>({__op:'timestamp'});
export const increment=value=>({__op:'increment',value});
export const arrayUnion=(...values)=>({__op:'union',values});
export const arrayRemove=(...values)=>({__op:'remove',values});
export const rtdbTimestamp=()=>Date.now();

export async function getDoc(ref){
 const {data,error}=await sb.from('nb_records').select('*').eq('path',ref.path).maybeSingle();
 fail(error);return makeSnapshot(ref,data);
}
export async function getDocs(ref){
 const q=normalizeQuery(ref), rows=[];
 const wanted=q.limit??Infinity;
 for(let offset=0;rows.length<wanted;){
   const pageSize=Math.min(1000,wanted-rows.length);
   const {data,error}=await sb.rpc('nb_query',{p_parent:ref.path,p_filters:encode(q.filters),p_order:q.order?.field??null,p_desc:q.order?.direction==='desc',p_limit:pageSize,p_offset:offset});
   fail(error);
   rows.push(...data);offset+=data.length;
   if(data.length<pageSize)break;
 }
 const docs=rows.map(row=>makeSnapshot(doc(getFirestore(),row.path),row));
 return {docs,size:docs.length,empty:!docs.length,forEach:fn=>docs.forEach(fn)};
}
async function commit(writes){
 const {error}=await sb.rpc('nb_commit',{p_writes:encode(writes)});fail(error);
 for(const listener of listeners)if(writes.some(w=>w.path===listener.ref.path||w.path.startsWith(listener.ref.path+'/')))listener.refresh();
}
export const setDoc=(ref,data,options={})=>commit([{path:ref.path,op:'set',data,merge:!!options.merge}]);
export const updateDoc=(ref,data)=>commit([{path:ref.path,op:'update',data}]);
export const deleteDoc=ref=>commit([{path:ref.path,op:'delete'}]);
export async function addDoc(ref,data){const result=doc(ref,crypto.randomUUID());await setDoc(result,data);return result;}
export async function runTransaction(_db,fn){
 for(let attempt=0;attempt<4;attempt++){
   const writes=[],versions=new Map();
   const tx={
     get:async ref=>{const snap=await getDoc(ref);versions.set(ref.path,snap.version);return snap;},
     set:(ref,data,options={})=>writes.push({path:ref.path,op:'set',data,merge:!!options.merge}),
     update:(ref,data)=>writes.push({path:ref.path,op:'update',data}),
     delete:ref=>writes.push({path:ref.path,op:'delete'})
   };
   const result=await fn(tx);
   for(const w of writes)if(versions.has(w.path))w.expectedVersion=versions.get(w.path);
   try{await commit(writes);return result;}catch(error){if(error.code!=='40001'||attempt===3)throw error;}
 }
}
export function onSnapshot(ref,onData,onError=report){
 let active=true,running=false,again=false,timer;
 const listener={ref,refresh:()=>{
   if(!active)return;
   if(running){again=true;return;}
   clearTimeout(timer);
   timer=setTimeout(async()=>{
     running=true;
     try{const snap=ref.kind==='doc'?await getDoc(ref):await getDocs(ref);if(active)onData(snap);}
     catch(e){if(active)onError(e);}
     finally{running=false;if(again){again=false;listener.refresh();}}
   },30);
 }};
 listener.stop=()=>{active=false;clearTimeout(timer);listeners.delete(listener);};
 listeners.add(listener);listener.refresh();
 return listener.stop;
}
function startLive(){
 if(socket)return;
 socket=sb.channel('nextbot-records-'+connectionId)
 .on('postgres_changes',{event:'*',schema:'public',table:'nb_records'},event=>{
   const path=event.new?.path||event.old?.path;
   for(const l of listeners)if(!path||path===l.ref.path||path.startsWith(l.ref.path+'/'))l.refresh();
 }).subscribe(status=>{
   connected=status==='SUBSCRIBED';
   if(connected)for(const l of listeners)l.refresh();
 });
 refreshTimer=setInterval(()=>{
   if(document.visibilityState==='hidden')return;
   for(const l of listeners)l.refresh();
   for(const [path,value] of presenceWrites)set({path},value).catch(report);
 },30000);
}
function stopLive(){
 clearInterval(refreshTimer);refreshTimer=null;connected=false;
 if(socket){sb.removeChannel(socket);socket=null;}
 for(const l of [...listeners])l.stop?.();
 rtHandlers.clear();presenceWrites.clear();
}

// Realtime Database-shaped calls backed by the same protected Postgres table.
export const ref=(_db,path)=>({kind:'rt',path});
export const push=parent=>{const key=crypto.randomUUID();return {kind:'rt',path:parent.path+'/'+key,key};};
function rtDocument(path){
 const parts=path.split('/');
 if(parts[0]==='presence')return 'rt/'+path+'/'+connectionId;
 return 'rt/'+path;
}
export async function set(reference,value){
 const p=reference.path,parts=p.split('/');
 if(parts[0]==='notifications'&&parts.length===4&&parts[3]==='read'){
   return updateDoc({path:'rt/'+parts.slice(0,3).join('/')},{read:!!value});
 }
 if(parts[0]==='presence'&&value?.state==='online')presenceWrites.set(p,value);
 if(parts[0]==='presence'&&value?.state!=='online')presenceWrites.delete(p);
 return setDoc({path:rtDocument(p)},value);
}
export async function remove(reference){
 if(reference.path.startsWith('presence/'))presenceWrites.delete(reference.path);
 return deleteDoc({path:rtDocument(reference.path)});
}
export function onDisconnect(){return {set:async()=>{ /* Presence expires server-side; no secret token is sent on unload. */ }};}
export function onValue(reference,onData,onError=report){
 const p=reference.path;
 if(p==='.info/connected'){
   let live=true;
   getDoc(doc(getFirestore(),'users',authState.currentUser?.uid)).then(()=>{if(live)onData({val:()=>true});}).catch(onError);
   const unsub=()=>{live=false;};trackRt(p,unsub);return unsub;
 }
 let active=true,running=false,again=false;
 const l={ref:{path:'rt/'+p},refresh:async()=>{
   if(!active)return;if(running){again=true;return;}running=true;
   try{
     const rows=[];
     for(let offset=0;;offset+=1000){
       const {data,error}=await sb.from('nb_records').select('*').like('path','rt/'+p+'/%').order('path').range(offset,offset+999);
       fail(error);rows.push(...data);if(data.length<1000)break;
     }
     const value={};
     for(const row of rows){
       const parts=row.path.split('/'),data=decode(row.data);
       if(parts[1]==='presence'){
         const online=data.state==='online'&&Date.now()-new Date(row.updated_at).getTime()<90000;
         if(!value[parts[2]]||online)value[parts[2]]={...data,state:online?'online':'offline'};
       }else if(parts[1]==='typing'){
         if(Date.now()-new Date(row.updated_at).getTime()<12000)value[parts[3]]=data;
       }else value[parts.at(-1)]=data;
     }
     if(active)onData({val:()=>value});
   }catch(e){if(active)onError(e);}finally{running=false;if(again){again=false;l.refresh();}}
 }};
 listeners.add(l);l.refresh();
 const expiry=setInterval(()=>l.refresh(),10000);
 const unsub=()=>{active=false;clearInterval(expiry);listeners.delete(l);};
 l.stop=unsub;
 trackRt(p,unsub);return unsub;
}
function trackRt(path,fn){if(!rtHandlers.has(path))rtHandlers.set(path,new Set());rtHandlers.get(path).add(fn);}
export function off(reference){for(const fn of rtHandlers.get(reference.path)||[])fn();rtHandlers.delete(reference.path);}
export function projectInfo(){return {url:config.url,projectId:config.projectId};}
