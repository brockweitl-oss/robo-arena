// Real browser arena regression: medium quality, actual fight phase, collision/support checks.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const base=process.env.BASE_URL??'http://127.0.0.1:5318';const out='test-results/pt3-arenas-final';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080}});const problems=[];page.on('pageerror',e=>problems.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))problems.push(m.text())});const report=[];
try {
 for(const id of ['foundry','garden','orbital','hangar','proving','sunken']) {
  await page.goto(`${base}/index.html?quick=mira&arena=${id}&time=30&autoplay`);
  await page.waitForFunction(()=>window.__game?.match?.phase==='fight',null,{timeout:45000});await page.waitForTimeout(3000);
  const result=await page.evaluate(async(id)=>{
   const game=window.__game,m=game.match,a=m.arena;
   const {groundHeightBelow}=await import('/src/game/collision.ts');
   const finite=a.colliders.every(c=>[...c.min.toArray(),...c.max.toArray()].every(Number.isFinite));
   const samples=[groundHeightBelow(0,13,1,a.colliders),groundHeightBelow(12,0,4,a.colliders),groundHeightBelow(7,0,4,a.colliders)];
   const shadows=[];a.root.traverse(o=>{if(o.isLight&&o.castShadow)shadows.push(o.type)});
   const hazards=a.hazards.map(h=>({warning:h.isWarning(6),active:h.isActive(8.5),down:h.down,launch:h.launch,damage:h.damage}));
   return {id,phase:m.phase,quality:game.gr.quality,fps:window.__fps,inputEnabled:game.input.enabled,finite,shadows:shadows.length,colliders:a.colliders.length,samples,hazards};
  },id);
  if(!result.finite||!result.inputEnabled||result.shadows>1)throw Error(`arena failed ${JSON.stringify(result)}`);
  if(['hangar','proving','sunken'].includes(id)&&result.samples.some((v,i)=>Math.abs(v-[0,3,1.5][i])>.02))throw Error(`support mismatch ${JSON.stringify(result)}`);
  if(['garden','orbital'].includes(id)&&result.hazards.some(h=>!h.warning||!h.active||h.down!==0||h.launch!==0))throw Error(`hazard timing ${JSON.stringify(result)}`);
  await page.screenshot({path:`${out}/${id}.jpg`,type:'jpeg',quality:85});report.push(result);console.log(JSON.stringify(result));
 }
 await page.evaluate(()=>window.__game.gr.setQuality('low'));await page.waitForTimeout(600);await page.evaluate(()=>window.__game.gr.setQuality('high'));await page.waitForTimeout(600);await page.evaluate(()=>window.__game.gr.setQuality('medium'));await page.waitForTimeout(600);
 if(problems.length)throw Error(problems.join('\n'));writeFileSync(`${out}/report.json`,JSON.stringify({report,problems},null,2));
}finally{await browser.close()}
