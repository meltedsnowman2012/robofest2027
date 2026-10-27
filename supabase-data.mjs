export function encode(value){
 if(value===undefined)throw new Error('저장할 값에 undefined가 있습니다.');
 if(value===null||typeof value!=='object')return value;
 if(typeof value.toMillis==='function')return {$ts:value.toMillis()};
 if(Array.isArray(value))return value.map(encode);
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
}
export function decode(value){
 if(value===null||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(decode);
 const ms=typeof value.$ts==='number'?value.$ts:
   Number.isFinite(value.seconds)?value.seconds*1000+(value.nanoseconds||0)/1000000:null;
 if(ms!==null)return {seconds:Math.floor(ms/1000),nanoseconds:Math.round((ms%1000)*1000000),toDate:()=>new Date(ms),toMillis:()=>ms};
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
}
export function makeSnapshot(ref,row){
 const exists=!!row;
 return {id:row?.path.split('/').at(-1)||ref.id||ref.path.split('/').at(-1),ref,
   version:Number(row?.version||0),exists:()=>exists,data:()=>exists?decode(row.data):undefined};
}
export function normalizeQuery(ref){
 const q={filters:[],order:null,limit:null};
 for(const c of ref.clauses||[]){
   if(c.type==='where')q.filters.push({field:c.field,op:c.op,value:c.value});
   else if(c.type==='order'){if(q.order)throw new Error('여러 정렬은 아직 지원하지 않습니다.');q.order=c;}
   else if(c.type==='limit'){if(!Number.isInteger(c.count)||c.count<1)throw new Error('잘못된 조회 개수');q.limit=c.count;}
 }
 return q;
}
