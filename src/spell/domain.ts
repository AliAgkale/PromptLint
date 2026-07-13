/**
 * promptlint-core — AI / tech domain vocabulary
 *
 * A curated accept-list of terms that are correct spellings but that neither
 * the English Hunspell dictionary nor the Italian frequency dictionary knows,
 * because they are recent, jargon, product names, or code identifiers:
 * "embeddings", "chatbot", "hyperparameter", "tokenizzazione", "vectorstore",
 * "Anthropic", "webhook", "middleware"…
 *
 * These are the words prompt authors use most, so flagging them as typos is
 * the single most credibility-damaging false positive the spell checker can
 * make (a prompt tool that red-underlines "prompt" and "LLM" looks broken).
 *
 * SCOPE: this is a spell-ACCEPT list only. It makes these terms count as
 * correctly spelled in BOTH languages (tech vocabulary is language-neutral and
 * appears constantly inside Italian prompts). It deliberately does NOT feed the
 * quality score — recognising a domain term is about not-flagging it, not about
 * rewarding it.
 *
 * Everything is stored lowercased; lookup lowercases the input. Multi-word
 * brand names are matched token-by-token (each token is listed separately),
 * so "hugging face" passes because both "hugging" and "face" resolve.
 */

const RAW: string[] = [
  // ── Core LLM / prompting vocabulary ──────────────────────────────────────
  'prompt', 'prompts', 'prompting', 'llm', 'llms', 'tech', 'token', 'tokens',
  'tokenize', 'tokenizer', 'tokenization', 'tokenizzazione', 'tokenizzatore',
  'detokenize', 'subword', 'bpe', 'embedding', 'embeddings', 'embed',
  'chatbot', 'chatbots', 'transformer', 'transformers', 'attention',
  'softmax', 'logits', 'logit', 'perplexity', 'temperature', 'temperatura',
  'top-k', 'top-p', 'nucleus', 'greedy', 'beam', 'sampling', 'hallucination',
  'hallucinations', 'hallucinate', 'grounding', 'context', 'contextual',
  'multimodal', 'multimodale', 'unimodal', 'zero-shot', 'few-shot', 'oneshot',
  'chain-of-thought', 'cot', 'reasoning', 'agentic', 'agent', 'agents',
  'autoregressive', 'decoder', 'encoder', 'seq2seq', 'pretraining',
  'pretrained', 'finetune', 'finetuning', 'fine-tune', 'fine-tuning',
  'fine-tuned', 'rlhf', 'dpo', 'distillation', 'quantization', 'quantized',
  'quantize', 'lora', 'qlora', 'peft', 'adapter', 'adapters', 'checkpoint',
  'checkpoints', 'inference', 'latency', 'throughput', 'hyperparameter',
  'hyperparameters', 'hyperparametro', 'epoch', 'epochs', 'gradient',
  'backpropagation', 'overfitting', 'underfitting', 'regularization',
  'dropout', 'softprompt', 'system-prompt', 'guardrail', 'guardrails',
  'jailbreak', 'jailbreaking', 'redteam', 'redteaming', 'alignment',
  'benchmark', 'benchmarks', 'eval', 'evals', 'leaderboard',

  // ── Retrieval / data ─────────────────────────────────────────────────────
  'rag', 'retrieval', 'reranker', 'reranking', 'vectorstore', 'vectordb',
  'vector', 'vectors', 'vectorize', 'cosine', 'faiss', 'pinecone', 'weaviate',
  'chroma', 'chromadb', 'qdrant', 'milvus', 'dataset', 'datasets', 'corpus',
  'corpora', 'annotation', 'annotations', 'labeling', 'labelling', 'schema',
  'schemas', 'ontology', 'metadata', 'json', 'jsonl', 'yaml', 'toml', 'csv',
  'tsv', 'xml', 'ndjson', 'parquet', 'protobuf', 'markdown', 'latex',

  // ── Providers / models / products ────────────────────────────────────────
  'anthropic', 'claude', 'opus', 'sonnet', 'haiku', 'openai', 'chatgpt',
  'gpt', 'davinci', 'codex', 'dall-e', 'dalle', 'whisper', 'google',
  'gemini', 'bard', 'palm', 'deepmind', 'meta', 'llama', 'llama2', 'llama3',
  'mistral', 'mixtral', 'cohere', 'command-r', 'perplexity',
  'huggingface', 'hugging', 'transformers', 'ollama', 'groq', 'together',
  'replicate', 'stability', 'midjourney', 'copilot', 'cursor', 'langchain',
  'llamaindex', 'autogen', 'crewai', 'mcp', 'a2a',

  // ── Programming languages / runtimes ─────────────────────────────────────
  'javascript', 'typescript', 'python', 'golang', 'rust', 'kotlin', 'swift',
  'scala', 'clojure', 'haskell', 'ruby', 'php', 'perl', 'lua', 'elixir',
  'dart', 'julia', 'nodejs', 'node', 'deno', 'bun', 'jvm', 'wasm',
  'webassembly', 'runtime', 'runtimes', 'async', 'await', 'coroutine',
  'coroutines', 'closure', 'closures', 'callback', 'callbacks', 'promise',
  'promises', 'iterator', 'generics', 'enum', 'enums', 'struct', 'structs',
  'boolean', 'booleans', 'int', 'float', 'nullable', 'undefined', 'nan',

  // ── Frameworks / libraries / tools ───────────────────────────────────────
  'react', 'reactjs', 'nextjs', 'vue', 'vuejs', 'svelte', 'sveltekit',
  'angular', 'nuxt', 'astro', 'remix', 'vite', 'webpack', 'rollup', 'esbuild',
  'babel', 'tailwind', 'tailwindcss', 'bootstrap', 'express', 'fastify',
  'nestjs', 'django', 'flask', 'fastapi', 'rails', 'laravel', 'spring',
  'dotnet', 'pytorch', 'tensorflow', 'keras', 'numpy', 'pandas', 'scikit',
  'sklearn', 'matplotlib', 'jupyter', 'notebook', 'notebooks', 'huggingface',
  'transformers', 'diffusers', 'accelerate', 'deepspeed', 'vllm', 'triton',
  'onnx', 'cuda', 'cudnn', 'tensorrt',

  // ── Infra / DevOps / cloud ───────────────────────────────────────────────
  'docker', 'dockerfile', 'kubernetes', 'k8s', 'helm', 'terraform', 'ansible',
  'nginx', 'apache', 'redis', 'memcached', 'kafka', 'rabbitmq', 'elasticsearch',
  'postgres', 'postgresql', 'mysql', 'mariadb', 'sqlite', 'mongodb', 'mongo',
  'dynamodb', 'cassandra', 'supabase', 'firebase', 'firestore', 'graphql',
  'grpc', 'websocket', 'websockets', 'webhook', 'webhooks', 'middleware',
  'middlewares', 'serverless', 'lambda', 'kubernetes', 'microservice',
  'microservices', 'devops', 'ci', 'cd', 'cicd', 'aws', 'gcp', 'azure',
  'cloudflare', 'vercel', 'netlify', 'heroku', 'kubectl', 'containerize',
  'containerized', 'orchestration', 'scalability', 'observability',

  // ── Web / API / general software ─────────────────────────────────────────
  'api', 'apis', 'sdk', 'sdks', 'cli', 'gui', 'ui', 'ux', 'url', 'uri',
  'uuid', 'http', 'https', 'rest', 'restful', 'crud', 'oauth', 'jwt',
  'auth', 'authn', 'authz', 'cors', 'csrf', 'xss', 'sql', 'nosql', 'orm',
  'frontend', 'backend', 'fullstack', 'full-stack', 'endpoint', 'endpoints',
  'payload', 'payloads', 'namespace', 'namespaces', 'repo', 'repos',
  'repository', 'monorepo', 'git', 'github', 'gitlab', 'bitbucket', 'commit',
  'commits', 'rebase', 'merge', 'changelog', 'linter', 'linting', 'lint',
  'refactor', 'refactoring', 'boilerplate', 'idempotent', 'stateless',
  'stateful', 'multithreaded', 'multithreading', 'concurrency', 'mutex',
  'deadlock', 'throughput', 'plaintext', 'ciphertext', 'hashing', 'checksum',
  'base64', 'utf', 'ascii', 'unicode', 'regex', 'regexp', 'stdin', 'stdout',
  'stderr', 'localhost', 'ip', 'dns', 'cdn', 'ssl', 'tls', 'vpn', 'ssh',
];

/** The domain accept-set. Lowercased, deduplicated. */
export const DOMAIN_TERMS: ReadonlySet<string> = new Set(
  RAW.map(w => w.toLowerCase())
);

/** True if `word` is a known AI/tech domain term (case-insensitive). Also
 *  accepts a trailing plural/possessive and hyphenated compounds whose parts
 *  are all domain terms ("prompt-engineering" → prompt + engineering). */
export function isDomainTerm(word: string): boolean {
  if (!word) return false;
  const w = word.toLowerCase();
  if (DOMAIN_TERMS.has(w)) return true;
  // trailing 's possessive / plural already mostly covered by explicit entries,
  // but handle the generic possessive here.
  if (w.endsWith("'s") && DOMAIN_TERMS.has(w.slice(0, -2))) return true;
  if (w.includes('-')) {
    const parts = w.split('-').filter(Boolean);
    if (parts.length > 1 && parts.every(p => DOMAIN_TERMS.has(p))) return true;
  }
  return false;
}

// Damerau-Levenshtein (adjacent transposition counts as 1 edit, not 2) — see
// src/spell/index.ts for the full rationale. Kept as a tiny local copy to
// avoid a circular import between domain.ts and index.ts.
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = val;
    }
  }
  return d[m]![n]!;
}

/** Close domain terms for a (possibly misspelled) word — so a typo of a domain
 *  term ("embeddigs", "webhok", "kubernets") gets the right suggestion, which
 *  nspell/the base dictionaries can't offer because they don't contain the
 *  domain word at all. Returned nearest-first. */
export function domainSuggestions(word: string, max = 3): string[] {
  const w = word.toLowerCase();
  if (w.length < 3) return [];
  const scored: Array<{ term: string; d: number }> = [];
  for (const term of DOMAIN_TERMS) {
    if (term.includes('-') || Math.abs(term.length - w.length) > 2) continue;
    const d = editDistance(w, term);
    if (d >= 1 && d <= 2) scored.push({ term, d });
  }
  return scored
    .sort((a, b) => a.d - b.d || a.term.localeCompare(b.term))
    .slice(0, max)
    .map(s => s.term);
}
