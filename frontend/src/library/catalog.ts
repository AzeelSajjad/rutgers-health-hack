export interface LibraryCard {id:string;name:string;age:number;visitReason:string;origin:'default'|'mimic_iv_demo';clinicalReviewStatus:'not_reviewed'|'reviewed';citation?:string;}
export function parseLibrary(value:unknown):LibraryCard[]{
  if(!value || typeof value!=='object' || !('cases' in value) || !Array.isArray(value.cases))throw new Error('Invalid case library response.');
  const ids=new Set<string>();
  for(const item of value.cases){
    if(!item || typeof item!=='object' || typeof item.id!=='string' || !/^[a-z0-9-]+$/.test(item.id) || ids.has(item.id)
      || typeof item.name!=='string' || !item.name.trim() || !Number.isInteger(item.age) || item.age<18
      || typeof item.visitReason!=='string' || !item.visitReason.trim() || !['default','mimic_iv_demo'].includes(item.origin)
      || !['not_reviewed','reviewed'].includes(item.clinicalReviewStatus)
      || (item.citation!==undefined && item.citation!=='https://doi.org/10.13026/dp1f-ex47'))throw new Error('Invalid case library response.');
    ids.add(item.id);
  }
  return value.cases;
}
