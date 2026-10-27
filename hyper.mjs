const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MODES={chat:['✦','일반'],code:['⌘','코딩'],debug:['⚒','디버깅'],strategy:['◎','전략'],meeting:['≡','회의 요약'],translate:['文','번역']};
const PROMPTS={chat:['이번 주 로봇 개발 계획을 세우고 싶어. 먼저 필요한 정보를 물어봐줘.','어려운 개념을 중학생도 이해할 수 있게 예시로 설명해줘.'],
 code:['아두이노에서 센서 값을 안정적으로 읽는 코드와 테스트 방법을 알려줘.','이 코드에 입력 검증과 오류 처리를 추가해줘:\n'],
 debug:['이 오류의 원인과 해결 순서를 알려줘:\n','로봇이 직진할 때 한쪽으로 치우쳐. 원인을 확인하는 실험을 설계해줘.'],
 strategy:['제공할 대회 규칙을 바탕으로 전략을 비교해줘. 필요한 정보를 먼저 물어봐줘.','로봇 개발의 위험 요소와 대회 전 점검표를 만들어줘.'],
 meeting:['선택한 채널의 최근 대화를 결정 사항, 미정 사항, 담당자별 다음 할 일로 정리해줘.','회의록을 5줄로 요약하고 후속 작업을 정리해줘:\n'],
 translate:['다음 글을 자연스러운 영어로 번역해줘:\n','다음 기술 문서를 쉬운 한국어로 번역해줘:\n']};
export function initHyper(api){
 let overlay,tab='ai',mode='chat',conversation=[],busy=false,controller=null,draft='',contextChannel='',lastUser=null,returnFocus=null,tick=null,searchGeneration=0,focusState=null,retain=false;
 const $=id=>document.getElementById(id);
 const uid=()=>api.context().user?.uid;
 const get=(name,fallback)=>{try{return JSON.parse(localStorage.getItem('nextbot:'+uid()+':'+name))??fallback;}catch{return fallback;}};
 const put=(name,value)=>{try{localStorage.setItem('nextbot:'+uid()+':'+name,JSON.stringify(value));return true;}catch{api.toast('브라우저 저장 공간이 부족합니다. 개인 백업 후 공간을 확보해주세요.');return false;}};
 const today=()=>new Date().toLocaleDateString('sv-SE');
 function normalizeTasks(){return get('todos',[]).filter(x=>x&&typeof x.text==='string').map(x=>({...x,id:x.id||crypto.randomUUID(),status:x.done?'done':x.status==='doing'?'doing':'todo',priority:['high','normal','low'].includes(x.priority)?x.priority:'normal'}));}
 function writeTasks(tasks){put('todos',tasks);api.refreshDashboard();}
 function syncAccount(){
  if(lastUser===uid())return;
  controller?.abort();busy=false;conversation=[];draft='';contextChannel='';mode='chat';clearInterval(tick);tick=null;
  if(overlay)close();lastUser=uid();retain=!!get('hyper-retain',false);
  if(retain)conversation=get('hyper-conversation',[]).filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string').slice(-24);
  focusState=get('hyper-focus',{remaining:25*60,end:0,running:false,kind:'focus',sessions:0});
 }
 function saveConversation(){if(retain)put('hyper-conversation',conversation.slice(-24));}
 function close(){
  if(!overlay)return;
  if($('hyperPrompt'))draft=$('hyperPrompt').value;
  overlay.remove();overlay=null;clearInterval(tick);tick=null;searchGeneration++;
  $('appView').inert=false;if(returnFocus?.isConnected)returnFocus.focus();
 }
 function open(nextTab='ai',options={}){
  if(!uid()){api.toast('먼저 로그인해주세요.');return;}
  syncAccount();if($('hyperPrompt'))draft=$('hyperPrompt').value;
  if(options.prompt!==undefined)draft=options.prompt;
  if(options.mode)mode=options.mode;
  if(options.channelId!==undefined)contextChannel=options.channelId||'';
  tab=nextTab;
  if(!overlay){
   returnFocus=document.activeElement;overlay=document.createElement('div');overlay.className='hyper-overlay';
   overlay.innerHTML='<section class="hyper-shell" role="dialog" aria-modal="true" aria-labelledby="hyperTitle"><header class="hyper-head"><span class="hyper-logo" aria-hidden="true">✦</span><div><h2 id="hyperTitle">NEXTBOT HYPER</h2><small>생각을 정리하고, 다음 작업으로.</small></div><button class="btn hyper-close" id="hyperClose" aria-label="작업 공간 닫기">✕</button></header><nav class="hyper-nav" role="tablist" aria-label="작업 공간">'+[['ai','✦ Grok AI'],['board','▦ 내 작업'],['search','⌕ 통합 검색'],['focus','◷ 집중']].map(([key,label])=>'<button role="tab" id="hyperTab-'+key+'" aria-controls="hyperContent" data-tab="'+key+'">'+label+'</button>').join('')+'</nav><main id="hyperContent" class="hyper-content" role="tabpanel"></main></section>';
   document.body.appendChild(overlay);$('appView').inert=true;
   $('hyperClose').onclick=close;overlay.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>open(b.dataset.tab));
   overlay.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
    if(e.key==='Tab'){const all=[...overlay.querySelectorAll('button:not(:disabled),input,textarea,select,a[href]')].filter(x=>x.getClientRects().length);
     if(e.shiftKey&&document.activeElement===all[0]){e.preventDefault();all.at(-1)?.focus();}
     else if(!e.shiftKey&&document.activeElement===all.at(-1)){e.preventDefault();all[0]?.focus();}}
   });
  }
  overlay.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
  $('hyperContent').setAttribute('aria-labelledby','hyperTab-'+tab);
  clearInterval(tick);tick=null;
  ({ai:renderAI,board:renderBoard,search:renderSearch,focus:renderFocus}[tab]||renderAI)();
  $('hyperContent').querySelector('textarea,input,button,select')?.focus();
 }
 function markdown(text){
  if(window.marked&&window.DOMPurify)return window.DOMPurify.sanitize(window.marked.parse(text),{FORBID_TAGS:['img','iframe','style','form','input','button'],FORBID_ATTR:['style']});
  return esc(text).replace(/\n/g,'<br>');
 }
 function renderAI(){
  const ch=api.context().channels.filter(x=>!x.feature);
  if(contextChannel&&!ch.some(x=>x.id===contextChannel))contextChannel='';
  $('hyperContent').innerHTML='<div class="hyper-ai-grid"><aside class="hyper-ai-options"><div><div class="hyper-eyebrow">YOUR COPILOT</div><h3>Grok과 함께</h3></div><div class="hyper-mode-grid">'+Object.entries(MODES).map(([key,[icon,label]])=>'<button data-mode="'+key+'" aria-pressed="'+(mode===key)+'">'+icon+' '+label+'</button>').join('')+'</div><label class="hyper-field">참고할 채널 <span class="hyper-muted">(선택 시 xAI로 전송)</span><select id="hyperContext"><option value="">없음 · 직접 입력만</option>'+ch.map(c=>'<option value="'+esc(c.id)+'" '+(c.id===contextChannel?'selected':'')+'># '+esc(c.name)+'</option>').join('')+'</select></label><div class="hyper-muted hyper-ai-note">선택한 채널의 최근 40개 이내 대화가 질문과 함께 xAI로 전송됩니다. AI가 팀 데이터를 자동으로 변경하지는 않습니다.</div><div class="hyper-suggestions"><div class="hyper-muted" style="margin-bottom:8px">바로 시작하기</div>'+PROMPTS[mode].map((p,i)=>'<button class="hyper-prompt-card" data-prompt="'+i+'" style="margin-bottom:8px;width:100%">'+esc(p)+'</button>').join('')+'</div><button class="btn" id="hyperNew">+ 새 대화</button><label class="hyper-muted"><input id="hyperRetain" type="checkbox" '+(retain?'checked':'')+'> 이 기기에 대화 기록 저장</label><button class="btn btn-sm" id="hyperExport">대화 내려받기</button><div class="hyper-muted" id="hyperConnection">Grok 연결 확인 중…</div></aside><section class="hyper-ai-main"><div id="hyperLog" class="hyper-log" aria-label="AI 대화"></div><form id="hyperAIForm" class="hyper-compose"><label class="hidden" for="hyperPrompt">Grok에게 질문</label><textarea id="hyperPrompt" maxlength="8000" placeholder="질문, 코드, 회의 내용을 입력하세요."></textarea><div class="hyper-row"><span class="hyper-muted"><span id="hyperChars">0</span>/8,000 · Ctrl+Enter 전송</span><button type="button" class="btn hyper-spacer" id="hyperCancel" '+(!busy?'hidden':'')+'>응답 기다리기 중단</button><button class="btn hyper-primary" id="hyperAsk" '+(busy?'disabled':'')+'>✦ Grok에게 묻기</button></div><div id="hyperAIStatus" class="hyper-status" role="status"></div></form></section></div>';
  $('hyperPrompt').value=draft;updateChars();renderLog();
  overlay.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{draft=$('hyperPrompt').value;mode=b.dataset.mode;renderAI();});
  overlay.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{$('hyperPrompt').value=PROMPTS[mode][Number(b.dataset.prompt)];draft=$('hyperPrompt').value;updateChars();$('hyperPrompt').focus();});
  $('hyperContext').onchange=()=>{contextChannel=$('hyperContext').value;};
  $('hyperPrompt').oninput=()=>{draft=$('hyperPrompt').value;updateChars();};
  $('hyperPrompt').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();ask();}};
  $('hyperAIForm').onsubmit=e=>{e.preventDefault();ask();};
  $('hyperCancel').onclick=()=>{controller?.abort();};
  $('hyperNew').onclick=()=>{if(busy){api.toast('응답 기다리기를 먼저 중단해주세요.');return;}conversation=[];draft='';saveConversation();renderAI();};
  $('hyperRetain').onchange=()=>{retain=$('hyperRetain').checked;put('hyper-retain',retain);if(retain)saveConversation();else put('hyper-conversation',[]);};
  $('hyperExport').onclick=()=>download('NEXTBOT-Grok-'+today()+'.md',conversation.map(x=>'## '+(x.role==='user'?'나':'Grok')+'\n\n'+x.content).join('\n\n'),'text/markdown');
  const owner=uid(),node=$('hyperConnection');
  api.ask({action:'status'}).then(r=>{if(uid()===owner&&node.isConnected)node.textContent=r.configured?'Grok · '+r.model+' · 1인 하루 '+r.dailyLimit+'회':'Grok API 키 설정 대기 · 관리자에게 문의';}).catch(e=>{if(node.isConnected)node.textContent=e.message;});
 }
 function updateChars(){if($('hyperChars'))$('hyperChars').textContent=String($('hyperPrompt').value.length);}
 function renderLog(){
  const log=$('hyperLog');if(!log)return;
  log.innerHTML=conversation.length?conversation.map((m,i)=>'<article class="hyper-bubble '+m.role+'"><div class="hyper-bubble-head">'+(m.role==='user'?'YOU':esc(m.model||'GROK'))+'</div><div class="hyper-text '+(m.role==='assistant'?'hyper-markdown':'')+'">'+(m.role==='assistant'?markdown(m.content):esc(m.content))+'</div>'+(m.role==='assistant'?'<div class="hyper-answer-actions"><button class="btn btn-sm" data-copy="'+i+'">복사</button><button class="btn btn-sm" data-insert="'+i+'">채팅 초안으로</button><button class="btn btn-sm" data-save-task="'+i+'">작업으로 추가</button><button class="btn btn-sm" data-retry="'+i+'" '+(busy?'disabled':'')+'>다시 답변</button></div>':'')+'</article>').join(''):'<div class="hyper-empty"><div class="spark">✦</div><h3>어떤 문제를 풀어볼까요?</h3><p class="hyper-muted" style="margin-top:10px">코드를 다듬고, 전략을 비교하고, 대화를 정리하세요.<br>답변은 여기에 표시되며 채널에 자동 전송되지 않습니다.</p></div>';
  log.querySelectorAll('a').forEach(a=>{if(!/^https?:\/\//i.test(a.getAttribute('href')||''))a.removeAttribute('href');a.target='_blank';a.rel='noopener noreferrer';});
  log.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>api.toast(await api.copy(conversation[Number(b.dataset.copy)].content)?'답변을 복사했습니다.':'복사하지 못했습니다.'));
  log.querySelectorAll('[data-insert]').forEach(b=>b.onclick=()=>{const text=conversation[Number(b.dataset.insert)].content;if(api.insertDraft('✦ Grok 답변\n'+text))close();});
  log.querySelectorAll('[data-save-task]').forEach(b=>b.onclick=()=>{const text=conversation[Number(b.dataset.saveTask)].content;open('board');$('hyperTaskText').value=text.slice(0,400);$('hyperTaskText').focus();api.toast('작업 제목을 다듬고 추가를 눌러주세요.');});
  log.querySelectorAll('[data-retry]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.retry),question=[...conversation.slice(0,i)].reverse().find(x=>x.role==='user');if(question){$('hyperPrompt').value=question.content;draft=question.content;updateChars();ask();}});
  log.scrollTop=log.scrollHeight;
 }
 async function ask(){
  if(busy)return;
  const prompt=$('hyperPrompt')?.value.trim();if(!prompt)return;
  if(!navigator.onLine){$('hyperAIStatus').textContent='인터넷 연결을 확인해주세요. 질문은 입력창에 남아 있습니다.';return;}
  const owner=uid(),requestMode=mode,channelId=contextChannel||null;
  let history=conversation.slice(-10).map(x=>({role:x.role,content:x.content.slice(0,10000)}));
  while(history.reduce((n,x)=>n+x.content.length,0)>30000)history.shift();
  busy=true;controller=new AbortController();const signal=controller.signal;
  $('hyperAsk').disabled=true;$('hyperCancel').hidden=false;
  const started=Date.now();const status=$('hyperAIStatus');status.classList.remove('hyper-error');
  status.textContent='Grok 응답을 기다리는 중…';
  const interval=setInterval(()=>{if(status.isConnected)status.textContent='Grok 응답을 기다리는 중 · '+Math.floor((Date.now()-started)/1000)+'초';},1000);
  try{
   const result=await api.ask({prompt,mode:requestMode,history,channelId},{signal});
   if(owner!==uid()||signal.aborted)return;
   conversation.push({role:'user',content:prompt},{role:'assistant',content:result.text,model:result.model});
   conversation=conversation.slice(-24);saveConversation();
   // Preserve edits made while the request was running.
   if(draft.trim()===prompt){draft='';if($('hyperPrompt'))$('hyperPrompt').value='';}
   renderLog();if($('hyperPrompt'))updateChars();
   if($('hyperAIStatus'))$('hyperAIStatus').textContent='완료 · 오늘 '+result.remaining+'회 남음'+(result.contextMessages?' · 참고 대화 '+result.contextMessages+'개':'')+(result.truncated?' · 답변 길이 제한에 도달했습니다. 이어서 질문해주세요.':'');
   if(!overlay||tab!=='ai')api.toast('Grok 답변이 도착했습니다. HYPER → Grok AI에서 확인하세요.');
  }catch(e){
   if(owner!==uid())return;
   const message=e.name==='AbortError'?'응답 기다리기를 중단했습니다. 서버에서 시작한 요청은 사용 횟수에 포함될 수 있습니다.':e.message;
   if($('hyperAIStatus')){$('hyperAIStatus').textContent=message;$('hyperAIStatus').classList.add('hyper-error');}else api.toast(message);
  }finally{clearInterval(interval);if(owner===uid()){busy=false;controller=null;if($('hyperAsk'))$('hyperAsk').disabled=false;if($('hyperCancel'))$('hyperCancel').hidden=true;overlay?.querySelectorAll('[data-retry]').forEach(b=>b.disabled=false);}}
 }
 function renderBoard(){
  const tasks=normalizeTasks(),done=tasks.filter(x=>x.done).length;
  // Assign stable IDs to legacy todos without discarding their fields.
  put('todos',tasks);
  $('hyperContent').innerHTML='<div class="hyper-row"><div><div class="hyper-eyebrow">MAKE IT HAPPEN</div><h3>내 작업 보드</h3><p class="hyper-muted">할 일을 작게 나누고, 하나씩 끝내세요. 이 계정의 현재 브라우저에 저장됩니다.</p></div><span class="hyper-pill hyper-spacer">'+done+'/'+tasks.length+' 완료</span><button class="btn" id="hyperTaskExport">백업</button></div><div class="hyper-progress"><span style="width:'+(tasks.length?Math.round(done/tasks.length*100):0)+'%"></span></div><form class="hyper-task-form" id="hyperTaskForm"><label class="hyper-field">할 일<input id="hyperTaskText" maxlength="400" required placeholder="예: 라인 센서 보정 실험"></label><label class="hyper-field">우선순위<select id="hyperTaskPriority"><option value="normal">보통</option><option value="high">높음</option><option value="low">낮음</option></select></label><label class="hyper-field">마감일<input id="hyperTaskDue" type="date"></label><button class="btn hyper-primary">+ 추가</button></form><div class="hyper-board">'+[['todo','할 일'],['doing','진행 중'],['done','완료']].map(([key,label])=>'<section class="hyper-column"><h4>'+label+'<span>'+tasks.filter(x=>x.status===key).length+'</span></h4>'+tasks.filter(x=>x.status===key).sort((a,b)=>({high:0,normal:1,low:2}[a.priority]-{high:0,normal:1,low:2}[b.priority])).map(x=>'<article class="hyper-task"><span class="hyper-priority">'+({high:'● 높음',normal:'● 보통',low:'○ 낮음'}[x.priority])+'</span><p>'+esc(x.text)+'</p><div class="hyper-row"><small class="'+(x.due&&x.due<today()&&!x.done?'hyper-overdue':'')+'">'+esc(x.due||'마감 없음')+'</small><select aria-label="'+esc(x.text)+' 상태" data-task-status="'+esc(x.id)+'" class="hyper-spacer">'+[['todo','할 일'],['doing','진행 중'],['done','완료']].map(([v,l])=>'<option value="'+v+'" '+(v===key?'selected':'')+'>'+l+'</option>').join('')+'</select><button class="btn btn-sm" data-task-edit="'+esc(x.id)+'">수정</button><button class="btn btn-sm" data-task-delete="'+esc(x.id)+'" aria-label="작업 삭제">✕</button></div></article>').join('')+(tasks.some(x=>x.status===key)?'':'<div class="hyper-muted">아직 작업이 없습니다.</div>')+'</section>').join('')+'</div>';
  $('hyperTaskForm').onsubmit=e=>{e.preventDefault();const text=$('hyperTaskText').value.trim();if(!text)return;const arr=normalizeTasks();arr.unshift({id:crypto.randomUUID(),text,done:false,status:'todo',priority:$('hyperTaskPriority').value,due:$('hyperTaskDue').value,createdAt:Date.now()});writeTasks(arr);renderBoard();$('hyperTaskText').focus();};
  $('hyperTaskExport').onclick=()=>download('NEXTBOT-tasks-'+today()+'.json',JSON.stringify({exportedAt:new Date().toISOString(),todos:normalizeTasks()},null,2),'application/json');
  overlay.querySelectorAll('[data-task-status]').forEach(s=>s.onchange=()=>{writeTasks(normalizeTasks().map(x=>x.id===s.dataset.taskStatus?{...x,status:s.value,done:s.value==='done'}:x));renderBoard();});
  overlay.querySelectorAll('[data-task-delete]').forEach(b=>b.onclick=()=>{const arr=normalizeTasks();const removed=arr.find(x=>x.id===b.dataset.taskDelete);writeTasks(arr.filter(x=>x.id!==b.dataset.taskDelete));renderBoard();const undo=document.createElement('button');undo.className='btn';undo.textContent='삭제 취소';$('hyperContent').prepend(undo);undo.onclick=()=>{writeTasks([removed,...normalizeTasks()]);renderBoard();};});
  overlay.querySelectorAll('[data-task-edit]').forEach(b=>b.onclick=()=>editTask(b.dataset.taskEdit));
 }
 function editTask(id){
  const task=normalizeTasks().find(x=>x.id===id);if(!task)return;
  const form=$('hyperTaskForm');$('hyperTaskText').value=task.text;$('hyperTaskPriority').value=task.priority;$('hyperTaskDue').value=task.due||'';
  form.querySelector('button').textContent='수정 저장';$('hyperTaskText').focus();
  form.onsubmit=e=>{e.preventDefault();const text=$('hyperTaskText').value.trim();if(!text)return;writeTasks(normalizeTasks().map(x=>x.id===id?{...x,text,priority:$('hyperTaskPriority').value,due:$('hyperTaskDue').value}:x));renderBoard();};
 }
 function renderSearch(){
  const ctx=api.context(),channels=ctx.channels.filter(x=>!x.feature);
  $('hyperContent').innerHTML='<div class="hyper-eyebrow">FIND YOUR NEXT STEP</div><h3>통합 검색</h3><p class="hyper-muted">채널 · 내 작업 · 북마크를 바로 찾으세요. 메시지는 선택한 채널의 최근 500개에서 검색합니다.</p><form id="hyperSearchForm" class="hyper-search-tools"><input id="hyperSearchText" aria-label="통합 검색어" placeholder="채널 이름, 할 일, 대화 내용…"><select id="hyperSearchChannel" aria-label="메시지 검색 채널">'+channels.map(c=>'<option value="'+esc(c.id)+'" '+(c.id===ctx.channelId?'selected':'')+'># '+esc(c.name)+'</option>').join('')+'</select><button class="btn hyper-primary" '+(!channels.length?'disabled':'')+'>메시지 검색</button></form><div id="hyperSearchStatus" class="hyper-status" role="status"></div><div id="hyperLocalResults"></div><div id="hyperMessageResults"></div>';
  $('hyperSearchText').oninput=renderLocalResults;
  $('hyperSearchForm').onsubmit=async e=>{
   e.preventDefault();const term=$('hyperSearchText').value.trim().toLowerCase(),channel=$('hyperSearchChannel').value;if(!term||!channel)return;
   const generation=++searchGeneration,owner=uid();$('hyperSearchStatus').textContent='최근 메시지를 불러오는 중…';$('hyperMessageResults').innerHTML='';
   try{const rows=await api.messages(channel,500);if(generation!==searchGeneration||owner!==uid()||!$('hyperMessageResults'))return;
    const found=rows.filter(x=>(x.content||x.question||'').toLowerCase().includes(term));
    $('hyperSearchStatus').textContent=rows.length+'개 중 '+found.length+'개 일치 · 오래된 메시지는 포함되지 않을 수 있습니다.';
    $('hyperMessageResults').innerHTML=found.slice(0,60).map((m,i)=>'<button class="hyper-result" data-message-result="'+i+'"><strong>'+esc(m.nickname||'팀원')+' · '+esc(m.time||'')+'</strong><small>'+esc((m.content||m.question||'').slice(0,600))+'</small></button>').join('')||'<div class="hyper-empty">일치하는 메시지가 없습니다.</div>';
    overlay.querySelectorAll('[data-message-result]').forEach(b=>b.onclick=()=>{const m=found[Number(b.dataset.messageResult)];close();api.goChannel(channel,m.id);});
   }catch(err){if(generation===searchGeneration&&$('hyperSearchStatus'))$('hyperSearchStatus').textContent=err.message;}
  };
  renderLocalResults();
 }
 function renderLocalResults(){
  const q=$('hyperSearchText').value.trim().toLowerCase(),ctx=api.context();const result=[];
  for(const c of ctx.channels.filter(x=>!q||x.name.toLowerCase().includes(q)).slice(0,10))result.push({kind:'채널',title:'# '+c.name,description:c.topic||'채널 열기',action:()=>{close();api.goChannel(c.id);}});
  for(const t of normalizeTasks().filter(x=>q&&x.text.toLowerCase().includes(q)).slice(0,8))result.push({kind:'내 작업',title:t.text,description:t.done?'완료':t.status==='doing'?'진행 중':'할 일',action:()=>open('board')});
  for(const b of get('bookmarks',[]).filter(x=>q&&(x.text||'').toLowerCase().includes(q)&&ctx.channels.some(c=>c.id===x.channelId)).slice(0,8))result.push({kind:'북마크',title:b.text,description:'# '+b.channelName,action:()=>{close();api.goChannel(b.channelId,b.msgId);}});
  $('hyperLocalResults').innerHTML=result.map((x,i)=>'<button class="hyper-result" data-local-result="'+i+'"><span class="hyper-pill">'+x.kind+'</span><strong>'+esc(x.title.slice(0,150))+'</strong><small>'+esc(x.description)+'</small></button>').join('')||'<div class="hyper-muted">일치하는 채널·작업·북마크가 없습니다.</div>';
  overlay.querySelectorAll('[data-local-result]').forEach(b=>b.onclick=result[Number(b.dataset.localResult)].action);
 }
 function persistFocus(){put('hyper-focus',focusState);}
 function renderFocus(){
  if(!focusState)focusState={remaining:1500,end:0,running:false,kind:'focus',sessions:0};
  $('hyperContent').innerHTML='<div class="hyper-eyebrow">ONE THING AT A TIME</div><h3>지금, 하나에 집중</h3><p class="hyper-muted">시간을 정하고 시작하세요. 탭을 닫았다 열어도 종료 시각을 기준으로 복원합니다.</p><div class="hyper-focus-wrap"><section class="hyper-focus-card"><div class="hyper-row"><button class="btn" data-duration="25">25분 집중</button><button class="btn" data-duration="50">50분 집중</button><button class="btn" data-duration="5">5분 휴식</button></div><div class="hyper-clock" id="hyperClock">25:00</div><div class="hyper-row"><button class="btn hyper-primary" id="hyperFocusToggle">시작</button><button class="btn" id="hyperFocusReset">초기화</button></div><p class="hyper-muted" id="hyperFocusMeta" style="margin-top:18px"></p></section><section class="hyper-focus-card"><h3 style="font-size:18px">집중할 작업</h3><select id="hyperFocusTask" aria-label="집중할 작업" style="width:100%;margin:16px 0"><option value="">작업 선택 (선택 사항)</option>'+normalizeTasks().filter(x=>!x.done).map(x=>'<option value="'+esc(x.id)+'" '+(focusState.taskId===x.id?'selected':'')+'>'+esc(x.text)+'</option>').join('')+'</select><button class="btn" id="hyperFocusDone">선택한 작업 완료</button><ol class="hyper-focus-list" style="margin-top:24px"><li>이번 시간에 끝낼 작은 목표를 정하세요.</li><li>알림과 방해 요소를 잠시 치워주세요.</li><li>시간이 끝나면 짧게 쉬고 진행 상황을 기록하세요.</li></ol></section></div>';
  overlay.querySelectorAll('[data-duration]').forEach(b=>b.onclick=()=>{focusState={...focusState,remaining:Number(b.dataset.duration)*60,running:false,end:0,kind:b.dataset.duration==='5'?'break':'focus'};persistFocus();updateClock();});
  $('hyperFocusToggle').onclick=()=>{if(focusState.running){focusState.remaining=Math.max(0,Math.ceil((focusState.end-Date.now())/1000));focusState.running=false;}else{if(focusState.remaining<=0)focusState.remaining=focusState.kind==='break'?300:1500;focusState.end=Date.now()+focusState.remaining*1000;focusState.running=true;}persistFocus();updateClock();};
  $('hyperFocusReset').onclick=()=>{focusState.running=false;focusState.remaining=focusState.kind==='break'?300:1500;focusState.end=0;persistFocus();updateClock();};
  $('hyperFocusTask').onchange=()=>{focusState.taskId=$('hyperFocusTask').value;persistFocus();};
  $('hyperFocusDone').onclick=()=>{const id=$('hyperFocusTask').value;if(!id){api.toast('먼저 작업을 선택해주세요.');return;}writeTasks(normalizeTasks().map(x=>x.id===id?{...x,done:true,status:'done'}:x));focusState.taskId='';persistFocus();renderFocus();};
  updateClock();clearInterval(tick);tick=setInterval(updateClock,500);
 }
 function updateClock(){
  if(!$('hyperClock'))return;
  let seconds=focusState.running?Math.max(0,Math.ceil((focusState.end-Date.now())/1000)):focusState.remaining;
  if(focusState.running&&seconds<=0){focusState.running=false;focusState.remaining=0;if(focusState.kind==='focus')focusState.sessions++;persistFocus();api.toast('집중 시간이 끝났습니다. 잠깐 쉬어가세요.');}
  $('hyperClock').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  $('hyperFocusToggle').textContent=focusState.running?'일시정지':seconds===0?'다시 시작':'시작';
  $('hyperFocusMeta').textContent=(focusState.kind==='break'?'휴식':'집중')+' · 완료한 집중 세션 '+focusState.sessions+'회';
 }
 function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type:type+';charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const launch=document.createElement('button');launch.id='hyperLaunch';launch.className='hyper-launch';launch.textContent='✦ HYPER';launch.title='Grok · 내 작업 · 통합 검색 · 집중';launch.onclick=()=>open('ai');document.querySelector('.topbar-right')?.prepend(launch);
 const hero=document.createElement('section');hero.className='hyper-hero';hero.innerHTML='<div><div class="hyper-eyebrow">NEXTBOT / HYPER WORKSPACE</div><h2>아이디어에서 다음 실행까지.</h2><p>Grok으로 생각을 넓히고, 작업 보드로 완성하세요.</p></div><div class="hyper-hero-actions"><button class="btn hyper-primary" id="hyperHeroAI">✦ Grok 열기</button><button class="btn" id="hyperHeroBoard">내 작업 보드 ↗</button><button class="btn" id="hyperHeroSearch">⌕ 검색</button></div>';
 document.querySelector('#dashboardView .dash')?.prepend(hero);
 if(!hero.isConnected)$('dashboardView')?.prepend(hero);
 $('hyperHeroAI').onclick=()=>open('ai');$('hyperHeroBoard').onclick=()=>open('board');$('hyperHeroSearch').onclick=()=>open('search');
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&uid()){e.preventDefault();e.stopImmediatePropagation();open('search');}},true);
 new MutationObserver(()=>{if(!$('appView').classList.contains('show')){controller?.abort();close();conversation=[];lastUser=null;}}).observe($('appView'),{attributes:true,attributeFilter:['class']});
 window.addEventListener('offline',()=>{launch.classList.add('hyper-offline');launch.title='오프라인 · 로컬 작업 보드와 타이머 사용 가능';});
 window.addEventListener('online',()=>{launch.classList.remove('hyper-offline');launch.title='Grok · 내 작업 · 통합 검색 · 집중';});
 return {open,close,reset:syncAccount};
}
