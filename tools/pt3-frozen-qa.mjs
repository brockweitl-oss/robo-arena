import {chromium} from 'playwright';
const base=process.env.BASE_URL??'http://127.0.0.1:5320';
const b=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:1920,height:1080}});const errors=[];
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text())});
try{
 await p.goto(`${base}/index.html?quick=mira&arena=hangar&time=10&autoplay`);
 await p.waitForFunction(()=>window.__game?.match?.phase==='fight',null,{timeout:30000});
 await p.screenshot({path:'test-results/playtest3-frozen.jpg',type:'jpeg',quality:85});
 await p.waitForFunction(()=>!!window.__lastResult,null,{timeout:60000});
 await p.waitForTimeout(5500);
 const result=await p.evaluate(()=>({outcome:window.__lastResult.outcome,events:JSON.parse(localStorage.getItem('robo-arena-telemetry')||'[]').filter(e=>e.type==='session_start'||e.type.startsWith('match_')).map(e=>({type:e.type,build:e.build,session:e.session})),fps:window.__fps}));
 if(!result.events.some(e=>e.type==='match_end'&&e.build.startsWith('pt3-')))throw Error('missing PT3 match telemetry');
 if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({result,errors}));
}finally{await b.close()}
