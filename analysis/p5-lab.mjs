/** Candidate per le classi di fuga, misurate sui 1863 prompt valutati. */
import { readFileSync } from 'node:fs';
const load=(p)=>readFileSync(new URL(p,import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const rows=[...load('../benchmark/benchmark1/corpus.jsonl'),...load('../benchmark/benchmark2/corpus.jsonl')];
const wc=t=>t.trim().split(/\s+/).length;
const material=t=>/["“”«»'][^"“”«»']{25,}["“”«»']/.test(t)||/:\s*\S[\s\S]{40,}/.test(t)||/\n\s*\n/.test(t)||/```/.test(t);

const PRIOR=/\b(ti avevo (?:dato|detto|mandato|inviato|chiesto|spiegato)|che avevo (?:mandato|dato|scritto|inviato)|mi avevi (?:consigliato|detto|suggerito|dato)|hai dimenticato|nella (?:nostra )?conversazione (?:precedente|passata)|la (?:settimana|volta) scorsa|ieri ti|come ti avevo|you forgot|in our (?:previous|last) (?:conversation|chat)|you (?:recommended|suggested|told me) (?:last|yesterday))\b/i;

const RESOURCE=/\b(https?:\/\/\S+|allegat[oi]|in allegato|attached|attachment|il file che ti ho (?:mandato|inviato)|questa è la (?:schermata|foto|immagine)|this (?:is the )?screenshot|il pdf|the pdf|il documento che ti ho)\b/i;
const ACTION=/\b(riassum\w*|analizz\w*|legg\w*|correggi|riscrivi|rivedi|sistem\w*|traduc\w*|valuta|summar\w*|analy[sz]\w*|read|fix|rewrite|review|translate|check|improve)\b/i;
const unreachable = t => !material(t) && RESOURCE.test(t) && ACTION.test(t);

const OPEN_Q=/\b(cosa (?:dovrei|devo|dobbiamo|faccio|facciamo|possiamo) fare|che cosa (?:faccio|facciamo)|cosa mi consigli|cosa faresti|cosa ci consigli|what should (?:i|we) do|what would you do|what do we do|how do we (?:fix|solve|grow))\b/i;
const consulting = t => OPEN_Q.test(t) && !material(t) && wc(t) <= 22;

const RHET=/\b(non è (?:forse )?vero che|chi non (?:vorrebbe|sogna)|who wouldn'?t|non è che non|sei sicuro di quello che hai detto|dimmi la verità)\b/i;
const rhetorical = t => RHET.test(t) && wc(t) <= 30;

for(const [name,fn] of [['memoria fra sessioni',t=>PRIOR.test(t)],['risorsa irraggiungibile',unreachable],['consulenza senza contesto',consulting],['retorica',rhetorical]]){
  let n=0,bad=0,good=0,mid=0; const g=[];
  for(const d of rows){ if(!fn(d.text)) continue; n++;
    if(d.human<45)bad++; else if(d.human>=66){good++;g.push(d);} else mid++; }
  const prec=n?100*bad/n:0;
  console.log(`${prec>=85&&n>0?'✓':'✗'} ${name.padEnd(28)} n=${String(n).padStart(4)}  prec=${prec.toFixed(1)}%  medi=${mid}  buoni=${good}`);
  for(const d of g.slice(0,3)) console.log(`      FP [${d.human}] ${d.text.slice(0,80)}`);
}
