/**
 * promptlint-core — SpellAdapter interface
 *
 * Both the full (nspell) and lite (dictionary-based) implementations
 * conform to this interface. The rest of the codebase only depends on
 * this abstraction — never on a specific implementation.
 */

export interface SpellAdapter {
  /** Returns true if the word is correctly spelled */
  correct(word: string): boolean;
  /** Returns up to `max` spelling suggestions */
  suggest(word: string, max?: number): string[];
  /** True once the adapter is ready to use */
  readonly ready: boolean;
  /**
   * Optional: set the active language for subsequent correct()/suggest() calls.
   * Adapters that don't support multi-language can omit this — callers should
   * check for its presence before calling.
   */
  setLanguage?(lang: string): void;
}

/** Words that should never be spell-checked regardless of adapter */
export const ALWAYS_SKIP = /^([A-Z]{2,}|\d|https?:\/\/)/;

/** Common programming / tech terms that are real tokens, not misspellings.
 *  These appear bare in prose ("usa async/await", "un dataset pulito") where
 *  code-region detection can't catch them. Lowercased at check time. */
const TECH_TERMS = new Set([
  'async','await','const','let','var','func','def','lambda','enum','struct',
  'null','undefined','nan','void','bool','boolean','int','float','string',
  'array','object','promise','callback','closure','middleware','endpoint',
  'backend','frontend','fullstack','runtime','compiler','linter','bundler',
  'dataset','pipeline','filtering','mapping','parsing','caching','logging',
  'debugging','refactoring','deployment','commit','merge','rebase','branch',
  'repo','repository','fetch','render','props','state','hook','hooks',
  'component','template','schema','query','mutation','subscription','regex',
  'boolean','timestamp','uuid','token','payload','webhook','cron','stdout',
  'stdin','stderr','env','config','localhost','wildcard','namespace','iterator',
  'generator','decorator','annotation','serialization','deserialization',
  'react','vue','svelte','angular','node','deno','bun','webpack','vite',
  'docker','kubernetes','nginx','redis','postgres','mongodb','graphql',
  'typescript','javascript','python','golang','rust','kotlin','swift',
  'conversion','wishlist','workflow','changelog','readme','gitignore',
  'serverless','stateless','stateful','serverside','clientside','microservice',
  'microservices','devops','sysadmin','oauth','websocket','graphql','nosql',
  'frontend','backend','fullstack','middleware','codebase','boilerplate',
  'linting','formatter','transpiler','polyfill','shim','monorepo','changeset',
]);

export function shouldSkipWord(word: string): boolean {
  if (word.length <= 1) return true;
  if (ALWAYS_SKIP.test(word)) return true;
  // camelCase / PascalCase / any internal capital → identifier, not a word.
  // (Previously anchored to ^, so it only caught words whose SECOND char was
  // uppercase — "gUser" but not "getUserById", and never "TypeScript".)
  // A real word has at most its first letter capitalized; an uppercase after
  // position 0 means camelCase (getUserById), PascalCase (TypeScript,
  // useState), or SCREAMING remnants.
  if (/[A-ZÀ-Ö]/.test(word.slice(1))) return true;
  const lower = word.toLowerCase();
  if (TECH_TERMS.has(lower)) return true;
  // Known abbreviations / acronyms
  const ABBREV = new Set([
    'api','url','http','https','html','css','js','ts','jsx','tsx',
    'sql','json','xml','yaml','csv','pdf','ai','ml','llm','gpt',
    'rag','gpu','cpu','sdk','ide','cli','gui','ui','ux','db','orm',
    'ci','cd','jwt','uuid','id','nb','aka','etc','vs','eg','ie',
    'lol','asap','fyi','tbd','imo','imho','afaik','btw','faq','kpi',
    'agi','asi','bert','rlhf',
  ]);
  return ABBREV.has(lower);
}
