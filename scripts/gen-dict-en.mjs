// Regenerates src/spell/dictionaryEn.data.ts from node_modules/dictionary-en.
// Run after bumping the dictionary-en version.
import fs from 'node:fs';

const aff = fs.readFileSync('node_modules/dictionary-en/index.aff', 'utf8');
const dic = fs.readFileSync('node_modules/dictionary-en/index.dic', 'utf8');

const out = `/**
 * Auto-generated from node_modules/dictionary-en (index.aff + index.dic),
 * inlined as plain strings so nspell can be constructed without going
 * through dictionary-en/index.js — that loader uses node:fs/promises,
 * which does not exist in a browser content script.
 * Regenerate: node scripts/gen-dict-en.mjs
 */

export const EN_AFF = ${JSON.stringify(aff)};
export const EN_DIC = ${JSON.stringify(dic)};
`;

fs.writeFileSync('src/spell/dictionaryEn.data.ts', out);
console.log('Wrote src/spell/dictionaryEn.data.ts —', out.length, 'bytes');
