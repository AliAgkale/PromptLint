import { getNspellAdapter } from '../src/spell/adapters/NspellAdapter.js';
const s = getNspellAdapter();
await new Promise(r=>setTimeout(r,4000));
for (const w of ['riformulalo','riformula','riformulare','riformulo','idiomatico','idiomatica','idiomatiche','debuggare','debug','microservizi','microservizio','analogica','fotografia','rendilo','sistemalo','dimmelo'])
  console.log(`${w.padEnd(16)} ${s.correct(w)}`);
