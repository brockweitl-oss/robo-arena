import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.BASE_URL || 'http://127.0.0.1:5324';
const out = 'docs/visuals/render-lifecycle'; await mkdir(out,{recursive:true});
const b = await chromium.launch({args:['--use-angle=d3d11','--enable-gpu']});
const p = await b.newPage({viewport:{width:1920,height:1080}});const errors=[];
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
try {
 await p.goto(`${base}/?quick=mira&arena=foundry&autoplay&time=90`);
 await p.waitForFunction(()=>window.__game?.match?.phase==='fight',null,{timeout:30000});
 await p.evaluate(()=>{const r=window.__game.gr;window.__passBaseline={passes:[r.effectPass,r.gradePass,r.chromaPass,r.smaaPass],materials:[r.effectPass,r.gradePass,r.chromaPass,r.smaaPass].map(p=>p.fullscreenMaterial)};});
 await p.screenshot({path:`${out}/medium-before-churn.jpg`});
 const samples=[];
 for(let i=0;i<4;i++) for(const quality of ['low','medium','high']) {
  const sample=await p.evaluate(q=>{const r=window.__game.gr;r.setQuality(q);const passes=[r.effectPass,r.gradePass,r.chromaPass,r.smaaPass];return {quality:q,stable:passes.every((p,i)=>p===window.__passBaseline.passes[i]&&p.fullscreenMaterial===window.__passBaseline.materials[i]),listeners:[r.bloom,r.tone,r.vignette,r.grade,r.grain,r.chroma,r.smaa].map(e=>e._listeners?.change?.length),screen:r.composer.passes.filter(p=>p.renderToScreen).length,programs:r.renderer.info.programs.length};},quality);
  assert.equal(sample.stable,true);assert.deepEqual(sample.listeners,[1,1,1,1,1,1,1]);assert.equal(sample.screen,1);samples.push(sample);await p.waitForTimeout(100);
 }
 await p.evaluate(()=>window.__game.gr.setQuality('medium'));await p.waitForTimeout(1800);
 await p.screenshot({path:`${out}/medium-after-churn.jpg`});
 const fps=await p.evaluate(()=>window.__fps);assert.deepEqual(errors,[]);
 const result={fps,errors,samples};await writeFile(`${out}/validation.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await b.close();}
