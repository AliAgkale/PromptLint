/* promptlint-core/full — web/CLI/VSCode build */

// src/tokenizer/index.ts
var ONE_TOKEN_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "must",
  "not",
  "this",
  "that",
  "it",
  "he",
  "she",
  "we",
  "they",
  "you",
  "i",
  "my",
  "your",
  "his",
  "her",
  "its",
  "our",
  "their",
  "me",
  "him",
  "us",
  "them",
  "what",
  "which",
  "who",
  "how",
  "when",
  "where",
  "why",
  "all",
  "no",
  "yes",
  "if",
  "so",
  "as",
  "up",
  "out",
  "into",
  "about",
  "after",
  "before",
  "than",
  "then",
  "there",
  "here",
  "now"
]);
function estimateChunkTokens(chunk) {
  if (/^[.,!?;:'"()\[\]{}<>\/\\|@#$%^&*+=`~\-]+$/.test(chunk))
    return chunk.length <= 2 ? 1 : Math.ceil(chunk.length / 2);
  if (/^\d+$/.test(chunk)) return Math.ceil(chunk.length / 3);
  if (/^https?:\/\//.test(chunk)) return Math.ceil(chunk.length / 4);
  if (/[_${}()[\]<>]/.test(chunk) && /[a-zA-Z]/.test(chunk))
    return Math.ceil(chunk.length / 3);
  const word = chunk.toLowerCase().replace(/[^a-z]/g, "");
  if (ONE_TOKEN_WORDS.has(word)) return 1;
  if (word.length <= 4) return 1;
  if (word.length <= 8) return /ing$|tion$|ness$|ment$|able$|ible$/.test(word) && word.length <= 6 ? 1 : 2;
  if (word.length <= 12) return 2;
  if (word.length <= 16) return 3;
  return Math.ceil(word.length / 5);
}
function estimateTokens(text) {
  if (!text?.trim()) return 0;
  const chunks = text.match(/\S+/g) ?? [];
  return Math.max(1, chunks.reduce((n, c) => n + estimateChunkTokens(c), 0));
}
function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])\s*$|\n{2,}/m).map((s) => s.trim()).filter((s) => s.length > 0);
}
function analyzeTokens(text) {
  if (!text?.trim()) {
    return {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
      charCountWithSpaces: 0,
      sentenceCount: 0,
      avgTokensPerWord: 0,
      avgTokensPerSentence: 0,
      tokenDensity: 0,
      tokensPerSentence: []
    };
  }
  const sentences = splitSentences(text);
  const tokensPerSentence = sentences.map((s) => estimateTokens(s));
  const words = (text.match(/\b\w+\b/g) ?? []).length;
  const charCount = text.replace(/\s/g, "").length;
  const tokenCount = estimateTokens(text);
  return {
    tokenCount,
    wordCount: words,
    charCount,
    charCountWithSpaces: text.length,
    sentenceCount: sentences.length,
    avgTokensPerWord: words > 0 ? Math.round(tokenCount / words * 100) / 100 : 0,
    avgTokensPerSentence: sentences.length > 0 ? Math.round(tokenCount / sentences.length) : 0,
    tokenDensity: charCount > 0 ? Math.round(tokenCount / charCount * 1e3) / 1e3 : 0,
    tokensPerSentence
  };
}

// src/tokenizer/costs.ts
var DEFAULT_PRICES = [
  { id: "gpt-5", name: "GPT-5", provider: "OpenAI", inputPer1M: 15, outputPer1M: 60, contextWindow: 128e3 },
  { id: "gpt-4.1", name: "GPT-4.1", provider: "OpenAI", inputPer1M: 2, outputPer1M: 8, contextWindow: 128e3 },
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", inputPer1M: 2.5, outputPer1M: 10, contextWindow: 128e3 },
  { id: "claude-sonnet", name: "Claude Sonnet 4.6", provider: "Anthropic", inputPer1M: 3, outputPer1M: 15, contextWindow: 2e5 },
  { id: "claude-opus", name: "Claude Opus 4.6", provider: "Anthropic", inputPer1M: 15, outputPer1M: 75, contextWindow: 2e5 },
  { id: "gemini-flash", name: "Gemini 2.0 Flash", provider: "Google", inputPer1M: 0.075, outputPer1M: 0.3, contextWindow: 1e6 },
  { id: "gemini-pro", name: "Gemini 2.0 Pro", provider: "Google", inputPer1M: 1.25, outputPer1M: 5, contextWindow: 2e6 }
];
function fmt(cost) {
  if (cost === 0) return "$0.0000";
  if (cost < 1e-4) return `$${cost.toExponential(2)}`;
  if (cost < 0.01) return `$${cost.toFixed(5)}`;
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
function estimateCosts(inputTokens, outputRatio = 2, prices = DEFAULT_PRICES) {
  const outTokens = Math.round(inputTokens * outputRatio);
  return prices.map((model) => {
    const ic = inputTokens / 1e6 * model.inputPer1M;
    const oc = outTokens / 1e6 * model.outputPer1M;
    const total = ic + oc;
    return {
      model,
      inputTokens,
      estimatedOutputTokens: outTokens,
      inputCost: ic,
      outputCost: oc,
      totalCost: total,
      formattedTotal: fmt(total),
      costPer1000Calls: total * 1e3
    };
  }).sort((a, b) => a.totalCost - b.totalCost);
}
function formatCost(cost) {
  return fmt(cost);
}

// src/spell/dictionary.ts
var DICTIONARY_WORDS = [
  // Extra short words that contractions map to (must be explicit since length <= 2 check)
  "do",
  "go",
  "be",
  "by",
  "he",
  "hi",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "no",
  "of",
  "ok",
  "on",
  "or",
  "so",
  "to",
  "up",
  "us",
  "we",
  "as",
  "at",
  "an",
  "am",
  "ax",
  "ay",
  "let",
  "get",
  "set",
  "put",
  "run",
  "cut",
  "hit",
  "sit",
  "fit",
  "bit",
  "bat",
  "cat",
  "hat",
  "mat",
  "pat",
  "rat",
  "sat",
  "vat",
  "bet",
  "met",
  "net",
  "pet",
  "vet",
  "wet",
  "yet",
  "bit",
  "kit",
  "pit",
  "wit",
  "bot",
  "dot",
  "got",
  "hot",
  "jot",
  "lot",
  "not",
  "pot",
  "rot",
  "tot",
  "bug",
  "dug",
  "hug",
  "jug",
  "mug",
  "rug",
  "tug",
  "bun",
  "fun",
  "gun",
  "nun",
  "pun",
  "run",
  "sun",
  "bar",
  "car",
  "far",
  "jar",
  "tar",
  "war",
  "her",
  "per",
  "sir",
  "fur",
  "add",
  "bed",
  "bid",
  "bad",
  "had",
  "mad",
  "sad",
  "big",
  "dig",
  "fig",
  "jig",
  "pig",
  "rig",
  "wig",
  "boy",
  "joy",
  "toy",
  "buy",
  "guy",
  "try",
  "dry",
  "cry",
  "fly",
  "fry",
  "pry",
  "sky",
  "spy",
  "shy",
  "why",
  "able",
  "about",
  "above",
  "abstract",
  "accessible",
  "accommodate",
  "according",
  "accuracy",
  "accurate",
  "achieve",
  "acknowledge",
  "across",
  "active",
  "actually",
  "adapt",
  "add",
  "added",
  "additional",
  "additionally",
  "adds",
  "adjust",
  "advanced",
  "advantage",
  "advice",
  "after",
  "against",
  "algorithm",
  "all",
  "allow",
  "allowed",
  "allows",
  "along",
  "already",
  "also",
  "although",
  "always",
  "am",
  "ambiguous",
  "among",
  "an",
  "analysis",
  "analyze",
  "analyzed",
  "analyzes",
  "and",
  "android",
  "annotate",
  "another",
  "answer",
  "answered",
  "answers",
  "any",
  "api",
  "apparently",
  "appear",
  "appeared",
  "appears",
  "application",
  "approach",
  "appropriate",
  "approximate",
  "approximately",
  "architecture",
  "are",
  "area",
  "argument",
  "around",
  "array",
  "articulate",
  "artificial",
  "as",
  "ask",
  "asked",
  "asks",
  "assess",
  "assign",
  "assistant",
  "async",
  "at",
  "attention",
  "attribute",
  "audit",
  "augmented",
  "authentication",
  "automated",
  "automation",
  "available",
  "away",
  "awful",
  "back",
  "backend",
  "backup",
  "bad",
  "bash",
  "basic",
  "batch",
  "be",
  "beautiful",
  "because",
  "been",
  "before",
  "began",
  "begin",
  "beginning",
  "begins",
  "behind",
  "being",
  "believe",
  "below",
  "benchmark",
  "beneath",
  "benefit",
  "bert",
  "beside",
  "best",
  "between",
  "beyond",
  "big",
  "billion",
  "binary",
  "book",
  "boolean",
  "both",
  "brief",
  "bring",
  "brings",
  "brought",
  "browser",
  "buffer",
  "build",
  "builds",
  "built",
  "business",
  "but",
  "by",
  "cache",
  "calculate",
  "calculated",
  "calculates",
  "calibrate",
  "call",
  "callback",
  "called",
  "calls",
  "came",
  "can",
  "careful",
  "case",
  "categorize",
  "category",
  "cause",
  "central",
  "certain",
  "chain",
  "change",
  "changed",
  "changes",
  "check",
  "checked",
  "checkpoint",
  "checks",
  "child",
  "city",
  "clarify",
  "class",
  "classification",
  "classified",
  "classifies",
  "classify",
  "claude",
  "clean",
  "clear",
  "clearly",
  "client",
  "close",
  "cloud",
  "cluster",
  "clustering",
  "code",
  "coherent",
  "cold",
  "collaborate",
  "come",
  "comes",
  "coming",
  "command",
  "comment",
  "committee",
  "common",
  "community",
  "company",
  "compare",
  "compared",
  "compares",
  "compatible",
  "complete",
  "completely",
  "complex",
  "component",
  "comprehensive",
  "compress",
  "compute",
  "concept",
  "concise",
  "conclude",
  "concrete",
  "condition",
  "config",
  "configuration",
  "configure",
  "consider",
  "considered",
  "considers",
  "consistent",
  "console",
  "consolidate",
  "constant",
  "constraint",
  "container",
  "content",
  "context",
  "continue",
  "continued",
  "continues",
  "controller",
  "convert",
  "converted",
  "converts",
  "correct",
  "cost",
  "could",
  "count",
  "cpu",
  "create",
  "created",
  "creates",
  "creative",
  "critical",
  "css",
  "current",
  "currently",
  "customize",
  "dark",
  "data",
  "database",
  "dataset",
  "day",
  "debug",
  "decide",
  "decided",
  "decides",
  "deduce",
  "deep",
  "define",
  "defined",
  "defines",
  "definitely",
  "definition",
  "demonstrate",
  "deploy",
  "deployment",
  "describe",
  "described",
  "describes",
  "description",
  "design",
  "designed",
  "designs",
  "detail",
  "detailed",
  "detect",
  "diagnose",
  "did",
  "different",
  "diffusion",
  "direct",
  "directive",
  "directly",
  "distillation",
  "do",
  "docker",
  "document",
  "documentation",
  "does",
  "doing",
  "domain",
  "down",
  "draft",
  "dreadful",
  "driver",
  "during",
  "dynamic",
  "each",
  "early",
  "easy",
  "effect",
  "effective",
  "efficient",
  "eight",
  "eighteen",
  "eighth",
  "eighty",
  "either",
  "elaborate",
  "eleven",
  "embedding",
  "emphasize",
  "end",
  "endpoint",
  "engineering",
  "enhance",
  "enumerate",
  "epoch",
  "error",
  "especially",
  "estimate",
  "evaluate",
  "evaluated",
  "evaluates",
  "even",
  "event",
  "every",
  "exactly",
  "example",
  "except",
  "exception",
  "execute",
  "exemplify",
  "expand",
  "expect",
  "expected",
  "expects",
  "experience",
  "explain",
  "explained",
  "explains",
  "explicit",
  "export",
  "extract",
  "extracted",
  "extracts",
  "eye",
  "fact",
  "faithful",
  "fast",
  "father",
  "fearful",
  "feature",
  "feedback",
  "feel",
  "feels",
  "felt",
  "fetch",
  "few",
  "field",
  "fifteen",
  "fifth",
  "fifty",
  "file",
  "filter",
  "final",
  "finally",
  "find",
  "finds",
  "first",
  "five",
  "fix",
  "flag",
  "flexible",
  "focused",
  "follow",
  "followed",
  "following",
  "follows",
  "for",
  "form",
  "formal",
  "format",
  "formats",
  "formatted",
  "forty",
  "found",
  "four",
  "fourteen",
  "fourth",
  "framework",
  "free",
  "friend",
  "from",
  "frontend",
  "full",
  "function",
  "further",
  "furthermore",
  "game",
  "gave",
  "gemini",
  "general",
  "generally",
  "generate",
  "generated",
  "generates",
  "generation",
  "generative",
  "get",
  "gets",
  "git",
  "give",
  "given",
  "gives",
  "global",
  "go",
  "goal",
  "goes",
  "going",
  "gone",
  "good",
  "got",
  "gotten",
  "government",
  "gpt",
  "gradient",
  "graph",
  "graphql",
  "grateful",
  "great",
  "grounding",
  "group",
  "had",
  "hallucination",
  "hand",
  "hard",
  "has",
  "have",
  "having",
  "he",
  "head",
  "help",
  "helped",
  "helpful",
  "helps",
  "hence",
  "her",
  "here",
  "hers",
  "herself",
  "high",
  "highlight",
  "highly",
  "him",
  "himself",
  "his",
  "home",
  "hopeful",
  "hot",
  "hour",
  "house",
  "however",
  "html",
  "http",
  "https",
  "human",
  "hundred",
  "hypothesize",
  "ide",
  "idea",
  "identified",
  "identifies",
  "identify",
  "if",
  "illustrate",
  "image",
  "immediately",
  "impact",
  "implement",
  "implementation",
  "implemented",
  "implements",
  "import",
  "important",
  "importantly",
  "improve",
  "improved",
  "improves",
  "in",
  "include",
  "included",
  "includes",
  "including",
  "independent",
  "index",
  "infer",
  "inference",
  "informal",
  "information",
  "infrastructure",
  "initialize",
  "innovative",
  "input",
  "inside",
  "install",
  "instead",
  "instruction",
  "integrate",
  "integration",
  "intelligence",
  "interface",
  "interpret",
  "into",
  "is",
  "issue",
  "it",
  "item",
  "its",
  "itself",
  "java",
  "javascript",
  "job",
  "joyful",
  "json",
  "just",
  "jwt",
  "keep",
  "keeps",
  "kept",
  "kind",
  "knew",
  "know",
  "known",
  "kotlin",
  "kubernetes",
  "label",
  "land",
  "language",
  "large",
  "largely",
  "last",
  "late",
  "layer",
  "learning",
  "leave",
  "leaves",
  "left",
  "level",
  "library",
  "life",
  "light",
  "likely",
  "likewise",
  "limit",
  "line",
  "lint",
  "linux",
  "list",
  "listed",
  "lists",
  "little",
  "live",
  "lived",
  "lives",
  "llama",
  "local",
  "logical",
  "long",
  "look",
  "looked",
  "looks",
  "loop",
  "loss",
  "lot",
  "low",
  "machine",
  "macos",
  "made",
  "main",
  "mainly",
  "maintain",
  "maintainable",
  "major",
  "make",
  "makes",
  "man",
  "manifest",
  "map",
  "may",
  "me",
  "meaningful",
  "measure",
  "memory",
  "merge",
  "message",
  "method",
  "middleware",
  "might",
  "migration",
  "million",
  "minimal",
  "mistral",
  "model",
  "modular",
  "module",
  "money",
  "monitor",
  "month",
  "more",
  "moreover",
  "most",
  "mostly",
  "mother",
  "move",
  "moved",
  "moves",
  "much",
  "multimodal",
  "multiple",
  "must",
  "mutation",
  "my",
  "myself",
  "name",
  "namespace",
  "natural",
  "near",
  "necessary",
  "need",
  "needed",
  "needs",
  "negative",
  "neither",
  "network",
  "neural",
  "never",
  "nevertheless",
  "new",
  "next",
  "night",
  "nine",
  "nineteen",
  "ninety",
  "ninth",
  "no",
  "node",
  "none",
  "nonetheless",
  "nor",
  "normalized",
  "not",
  "note",
  "now",
  "number",
  "object",
  "obvious",
  "occasion",
  "occurrence",
  "of",
  "off",
  "often",
  "old",
  "on",
  "once",
  "one",
  "only",
  "onto",
  "open",
  "optimize",
  "optimized",
  "option",
  "or",
  "organize",
  "organized",
  "organizes",
  "original",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "outline",
  "output",
  "outside",
  "over",
  "overview",
  "own",
  "package",
  "paragraph",
  "parameter",
  "paraphrase",
  "parse",
  "part",
  "particular",
  "particularly",
  "passive",
  "past",
  "patch",
  "pattern",
  "peaceful",
  "people",
  "performance",
  "perhaps",
  "phase",
  "php",
  "pipeline",
  "place",
  "plan",
  "planned",
  "plans",
  "play",
  "played",
  "plays",
  "plugin",
  "point",
  "port",
  "position",
  "positive",
  "possible",
  "power",
  "powerful",
  "practical",
  "precise",
  "precision",
  "predict",
  "predicted",
  "predicts",
  "prevent",
  "previously",
  "primary",
  "principle",
  "prioritize",
  "private",
  "privilege",
  "probably",
  "problem",
  "process",
  "production",
  "professional",
  "program",
  "promise",
  "prompt",
  "protocol",
  "provide",
  "provided",
  "provides",
  "proxy",
  "public",
  "publish",
  "python",
  "qualify",
  "quality",
  "quantify",
  "quantization",
  "query",
  "question",
  "queue",
  "quickly",
  "ran",
  "rank",
  "rate",
  "rather",
  "read",
  "reading",
  "reads",
  "ready",
  "real",
  "really",
  "reason",
  "reasoning",
  "recall",
  "receive",
  "recent",
  "recently",
  "recommend",
  "recommendation",
  "recommended",
  "recommends",
  "recursion",
  "redundant",
  "refactor",
  "reference",
  "refine",
  "reformulate",
  "regression",
  "reinforcement",
  "release",
  "relevant",
  "reliable",
  "remain",
  "remained",
  "remains",
  "render",
  "reorganize",
  "rephrase",
  "report",
  "reported",
  "reports",
  "repository",
  "represent",
  "request",
  "require",
  "required",
  "requirement",
  "requires",
  "research",
  "resolve",
  "resource",
  "response",
  "rest",
  "restore",
  "restructure",
  "result",
  "retrieval",
  "review",
  "reviewed",
  "reviews",
  "right",
  "role",
  "room",
  "ruby",
  "rule",
  "run",
  "runs",
  "runtime",
  "rust",
  "sample",
  "saw",
  "scalable",
  "schema",
  "script",
  "search",
  "second",
  "section",
  "secure",
  "security",
  "see",
  "seem",
  "seemed",
  "seems",
  "seen",
  "sees",
  "select",
  "semantic",
  "send",
  "sends",
  "sent",
  "sentence",
  "separate",
  "serious",
  "server",
  "service",
  "session",
  "setting",
  "setup",
  "seven",
  "seventeen",
  "seventh",
  "seventy",
  "shall",
  "she",
  "short",
  "should",
  "show",
  "showed",
  "shows",
  "side",
  "significant",
  "similar",
  "similarity",
  "similarly",
  "simple",
  "simply",
  "simulate",
  "simultaneous",
  "since",
  "single",
  "six",
  "sixteen",
  "sixth",
  "sixty",
  "skillful",
  "slightly",
  "small",
  "so",
  "socket",
  "solution",
  "solve",
  "solved",
  "solves",
  "some",
  "sometimes",
  "soon",
  "sophisticated",
  "sort",
  "special",
  "specific",
  "specifically",
  "specify",
  "speech",
  "split",
  "sql",
  "stack",
  "stage",
  "standard",
  "start",
  "started",
  "starts",
  "state",
  "static",
  "stay",
  "stayed",
  "stays",
  "step",
  "still",
  "story",
  "string",
  "strong",
  "structure",
  "structured",
  "study",
  "style",
  "subject",
  "successful",
  "such",
  "suggest",
  "suggested",
  "suggestion",
  "suggests",
  "summarize",
  "summarized",
  "summarizes",
  "summary",
  "supervised",
  "sure",
  "swift",
  "synchronize",
  "syntax",
  "system",
  "table",
  "tailor",
  "take",
  "taken",
  "takes",
  "task",
  "technical",
  "tell",
  "tells",
  "temperature",
  "template",
  "ten",
  "tenth",
  "term",
  "test",
  "tested",
  "tests",
  "text",
  "than",
  "thankful",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "therefore",
  "these",
  "they",
  "think",
  "thinks",
  "third",
  "thirteen",
  "thirty",
  "this",
  "those",
  "though",
  "thought",
  "thoughtful",
  "thousand",
  "thread",
  "three",
  "through",
  "throughout",
  "thus",
  "time",
  "timeout",
  "to",
  "together",
  "token",
  "tokenization",
  "told",
  "too",
  "took",
  "tool",
  "topic",
  "toward",
  "trace",
  "traditional",
  "training",
  "transform",
  "transformer",
  "translate",
  "translated",
  "translates",
  "transparent",
  "tried",
  "tries",
  "trigger",
  "troubleshoot",
  "true",
  "truthful",
  "try",
  "turn",
  "turned",
  "turns",
  "twelve",
  "twenty",
  "two",
  "type",
  "typescript",
  "typical",
  "typically",
  "ubuntu",
  "under",
  "unique",
  "unless",
  "unsupervised",
  "until",
  "up",
  "update",
  "upon",
  "url",
  "use",
  "used",
  "useful",
  "user",
  "uses",
  "usually",
  "vague",
  "valid",
  "validate",
  "validated",
  "validation",
  "value",
  "variable",
  "various",
  "vector",
  "verbose",
  "versatile",
  "version",
  "very",
  "visible",
  "vision",
  "visualize",
  "vocabulary",
  "want",
  "wanted",
  "wants",
  "warning",
  "was",
  "water",
  "way",
  "we",
  "webhook",
  "week",
  "well",
  "went",
  "were",
  "what",
  "when",
  "where",
  "whether",
  "which",
  "while",
  "who",
  "whole",
  "whom",
  "whose",
  "widely",
  "will",
  "window",
  "windows",
  "with",
  "within",
  "without",
  "woman",
  "wonderful",
  "word",
  "work",
  "worker",
  "workflow",
  "world",
  "would",
  "write",
  "writes",
  "wrote",
  "yaml",
  "year",
  "yet",
  "you",
  "young",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "youthful",
  "zero",
  // Found missing via real testing while building the weak-verb rule —
  // base forms only; deriveRoots() in spell/index.ts recovers the
  // inflections (handles/handled/handling, etc.) from these automatically,
  // so the gap was really just these roots, not every inflected form.
  "handle",
  "address",
  "investigate",
  "manage",
  "deal",
  "contact",
  "account",
  "person",
  "project"
];
var DICTIONARY = new Set(DICTIONARY_WORDS);

// src/spell/dictionary.it.ts
var DICTIONARY_WORDS_IT = [
  "a",
  "abbastanza",
  "abbiamo",
  "abitualmente",
  "adesso",
  "affinche",
  "affinch\xE9",
  "aggiornamento",
  "aggiunge",
  "aggiungere",
  "aggiungete",
  "aggiungi",
  "aggiungiamo",
  "aggiungo",
  "aggiungono",
  "aggiunta",
  "aggiunto",
  "agli",
  "ai",
  "al",
  "alcuna",
  "alcune",
  "alcuni",
  "alcuno",
  "algoritmo",
  "alla",
  "alle",
  "allo",
  "alta",
  "alte",
  "alti",
  "alto",
  "altra",
  "altre",
  "altri",
  "altro",
  "ambigua",
  "ambigue",
  "ambigui",
  "ambiguo",
  "analisi",
  "analizza",
  "analizzano",
  "analizzare",
  "analizzate",
  "analizzato",
  "analizzi",
  "analizziamo",
  "analizzo",
  "anche",
  "ancora",
  "andare",
  "andate",
  "andava",
  "andavi",
  "andavo",
  "andiamo",
  "anno",
  "anzi",
  "appena",
  "applicazione",
  "apprendimento",
  "appropriata",
  "appropriate",
  "appropriati",
  "appropriato",
  "architettura",
  "argomento",
  "artificiale",
  "attiva",
  "attive",
  "attivi",
  "attivo",
  "attuale",
  "attuali",
  "attualmente",
  "automatico",
  "automazione",
  "avere",
  "avete",
  "aveva",
  "avevamo",
  "avevano",
  "avevate",
  "avevi",
  "avevo",
  "avrai",
  "avranno",
  "avremo",
  "avrete",
  "avr\xE0",
  "avr\xF2",
  "avuta",
  "avute",
  "avuti",
  "avuto",
  "avviso",
  "azienda",
  "bambina",
  "bambino",
  "bassa",
  "basse",
  "bassi",
  "basso",
  "benche",
  "bench\xE9",
  "bene",
  "beneficio",
  "breve",
  "brevi",
  "buona",
  "buone",
  "buoni",
  "buono",
  "caff\xE8",
  "calda",
  "calde",
  "caldi",
  "caldo",
  "cambi",
  "cambia",
  "cambiamo",
  "cambiano",
  "cambiare",
  "cambiata",
  "cambiate",
  "cambiato",
  "cambio",
  "campione",
  "capiamo",
  "capire",
  "capisce",
  "capisci",
  "capisco",
  "capiscono",
  "capita",
  "capite",
  "capito",
  "capitolo",
  "caratteristica",
  "casa",
  "caso",
  "cattiva",
  "cattive",
  "cattivi",
  "cattivo",
  "causa",
  "cento",
  "certamente",
  "che",
  "chi",
  "chiara",
  "chiaramente",
  "chiare",
  "chiari",
  "chiaro",
  "chiede",
  "chiedere",
  "chiedete",
  "chiedi",
  "chiediamo",
  "chiedo",
  "chiedono",
  "chiesta",
  "chiesto",
  "ci",
  "cinquanta",
  "cinque",
  "citt\xE0",
  "ci\xF2",
  "classe",
  "codice",
  "coi",
  "col",
  "come",
  "commento",
  "compito",
  "completa",
  "completamente",
  "complete",
  "completi",
  "completo",
  "comunque",
  "con",
  "concetto",
  "concisa",
  "concise",
  "concisi",
  "conciso",
  "condizione",
  "configurazione",
  "confronta",
  "confrontano",
  "confrontare",
  "confrontate",
  "confrontato",
  "confronti",
  "confrontiamo",
  "confronto",
  "considera",
  "considerano",
  "considerare",
  "considerate",
  "considerato",
  "consideri",
  "consideriamo",
  "considero",
  "consiglio",
  "contenuto",
  "contesto",
  "continua",
  "continuano",
  "continuare",
  "continuate",
  "continuato",
  "continui",
  "continuiamo",
  "continuo",
  "controlla",
  "controllano",
  "controllare",
  "controllate",
  "controllato",
  "controlli",
  "controlliamo",
  "controllo",
  "corregge",
  "correggere",
  "correggete",
  "correggi",
  "correggiamo",
  "correggo",
  "correggono",
  "corretta",
  "corrette",
  "corretti",
  "corretto",
  "cosa",
  "cosicch\xE9",
  "costante",
  "costo",
  "costruiamo",
  "costruire",
  "costruisce",
  "costruisci",
  "costruisco",
  "costruiscono",
  "costruite",
  "costruito",
  "cos\xEC",
  "crea",
  "creano",
  "creare",
  "creata",
  "create",
  "creato",
  "crei",
  "creiamo",
  "creo",
  "cui",
  "da",
  "dagli",
  "dai",
  "dal",
  "dalla",
  "dalle",
  "dallo",
  "danno",
  "dare",
  "data",
  "dataset",
  "date",
  "dati",
  "dato",
  "dava",
  "davi",
  "davo",
  "debole",
  "deboli",
  "decimo",
  "definizione",
  "degli",
  "dei",
  "delle",
  "descritta",
  "descritto",
  "descrive",
  "descrivere",
  "descrivete",
  "descrivi",
  "descriviamo",
  "descrivo",
  "descrivono",
  "descrizione",
  "dettagliata",
  "dettagliate",
  "dettagliati",
  "dettagliato",
  "deve",
  "devi",
  "devo",
  "devono",
  "di",
  "diamo",
  "dice",
  "diceva",
  "dicevi",
  "dicevo",
  "dici",
  "diciamo",
  "diciannove",
  "diciassette",
  "diciotto",
  "dico",
  "dicono",
  "dieci",
  "difficile",
  "difficili",
  "dire",
  "direttamente",
  "disponibile",
  "disponibili",
  "dite",
  "diversa",
  "diverse",
  "diversi",
  "diverso",
  "do",
  "dobbiamo",
  "documentazione",
  "documento",
  "dodici",
  "domanda",
  "domani",
  "donna",
  "dove",
  "dovere",
  "dovete",
  "doveva",
  "dovevi",
  "dovevo",
  "dovunque",
  "due",
  "dunque",
  "e",
  "effettivamente",
  "effetto",
  "efficace",
  "efficaci",
  "efficiente",
  "efficienti",
  "elaborazione",
  "elenca",
  "elencano",
  "elencare",
  "elencate",
  "elencato",
  "elenchi",
  "elenchiamo",
  "elenco",
  "era",
  "erano",
  "eravamo",
  "eravate",
  "eri",
  "ero",
  "errore",
  "esempio",
  "essere",
  "evidente",
  "evidentemente",
  "evidenti",
  "fa",
  "facciamo",
  "faccio",
  "faceva",
  "facevamo",
  "facevano",
  "facevate",
  "facevi",
  "facevo",
  "facile",
  "facili",
  "fai",
  "falsa",
  "false",
  "falsi",
  "falso",
  "famiglia",
  "fanno",
  "farai",
  "faranno",
  "fare",
  "faremo",
  "farete",
  "far\xE0",
  "far\xF2",
  "fase",
  "fate",
  "fatta",
  "fatte",
  "fatti",
  "fatto",
  "feedback",
  "file",
  "finch\xE9",
  "finiamo",
  "finire",
  "finisce",
  "finisci",
  "finisco",
  "finiscono",
  "finita",
  "finite",
  "finito",
  "flusso",
  "formato",
  "formatta",
  "formattano",
  "formattare",
  "formattate",
  "formattato",
  "formatti",
  "formattiamo",
  "formatto",
  "forniamo",
  "fornire",
  "fornisce",
  "fornisci",
  "fornisco",
  "forniscono",
  "fornita",
  "fornite",
  "fornito",
  "forse",
  "forte",
  "forti",
  "fra",
  "frase",
  "fredda",
  "fredde",
  "freddi",
  "freddo",
  "funzionalit\xE0",
  "funzione",
  "genera",
  "generale",
  "generali",
  "generalmente",
  "generano",
  "generare",
  "generata",
  "generate",
  "generato",
  "generi",
  "generiamo",
  "genero",
  "gente",
  "giorno",
  "giusta",
  "giuste",
  "giusti",
  "giusto",
  "gi\xE0",
  "gi\xF9",
  "gli",
  "governo",
  "grande",
  "grandi",
  "gruppo",
  "ha",
  "hai",
  "hanno",
  "ho",
  "i",
  "idea",
  "identifica",
  "identificano",
  "identificare",
  "identificate",
  "identificato",
  "identifichi",
  "identifichiamo",
  "identifico",
  "ieri",
  "il",
  "impatto",
  "implementa",
  "implementano",
  "implementare",
  "implementate",
  "implementato",
  "implementazione",
  "implementi",
  "implementiamo",
  "implemento",
  "importante",
  "importanti",
  "impostazione",
  "in",
  "include",
  "includere",
  "includete",
  "includi",
  "includiamo",
  "includo",
  "includono",
  "inclusa",
  "incluso",
  "indirettamente",
  "infatti",
  "informazione",
  "inizi",
  "inizia",
  "iniziamo",
  "iniziano",
  "iniziare",
  "iniziata",
  "iniziate",
  "iniziato",
  "inizio",
  "inoltre",
  "input",
  "integrazione",
  "intelligenza",
  "interamente",
  "interfaccia",
  "inutile",
  "inutili",
  "invece",
  "io",
  "istruzione",
  "la",
  "laggi\xF9",
  "lasci",
  "lascia",
  "lasciamo",
  "lasciano",
  "lasciare",
  "lasciata",
  "lasciate",
  "lasciato",
  "lascio",
  "lass\xF9",
  "lavoro",
  "le",
  "legge",
  "leggere",
  "leggete",
  "leggi",
  "leggiamo",
  "leggo",
  "leggono",
  "lei",
  "lenta",
  "lente",
  "lenti",
  "lento",
  "letta",
  "letto",
  "li",
  "libera",
  "libere",
  "liberi",
  "libero",
  "libreria",
  "linguaggio",
  "livello",
  "lo",
  "loro",
  "lui",
  "lunga",
  "lunghe",
  "lunghi",
  "lungo",
  "l\xE0",
  "l\xEC",
  "ma",
  "mai",
  "male",
  "mano",
  "mattina",
  "me",
  "medesima",
  "medesimo",
  "meglio",
  "mentre",
  "mese",
  "metodo",
  "mi",
  "mia",
  "mie",
  "miei",
  "migliora",
  "migliorano",
  "migliorare",
  "migliorate",
  "migliorato",
  "migliori",
  "miglioriamo",
  "miglioro",
  "miliardo",
  "milione",
  "mille",
  "minuto",
  "mio",
  "modello",
  "moderna",
  "moderne",
  "moderni",
  "moderno",
  "modo",
  "molta",
  "molte",
  "molti",
  "molto",
  "mondo",
  "mostra",
  "mostrano",
  "mostrare",
  "mostrata",
  "mostrate",
  "mostrato",
  "mostri",
  "mostriamo",
  "mostro",
  "motivo",
  "ne",
  "necessari",
  "necessaria",
  "necessarie",
  "necessario",
  "negativa",
  "negative",
  "negativi",
  "negativo",
  "negli",
  "nei",
  "nel",
  "nella",
  "nelle",
  "nello",
  "nessuna",
  "nessuno",
  "neurale",
  "niente",
  "no",
  "noi",
  "non",
  "nono",
  "nonostante",
  "normalmente",
  "nostra",
  "nostre",
  "nostri",
  "nostro",
  "nota",
  "notte",
  "novanta",
  "nove",
  "nulla",
  "numero",
  "nuova",
  "nuove",
  "nuovi",
  "nuovo",
  "n\xE9",
  "o",
  "obiettivo",
  "occhio",
  "occupata",
  "occupate",
  "occupati",
  "occupato",
  "oggetto",
  "oggi",
  "ogni",
  "ognuna",
  "ognuno",
  "opzione",
  "ora",
  "ottanta",
  "ottavo",
  "ottimizza",
  "ottimizzano",
  "ottimizzare",
  "ottimizzate",
  "ottimizzato",
  "ottimizzazione",
  "ottimizzi",
  "ottimizziamo",
  "ottimizzo",
  "otto",
  "output",
  "ovunque",
  "ovviamente",
  "paese",
  "panoramica",
  "paragrafo",
  "parametro",
  "parla",
  "parlano",
  "parlare",
  "parlata",
  "parlate",
  "parlato",
  "parlavo",
  "parli",
  "parliamo",
  "parlo",
  "parola",
  "parte",
  "parziale",
  "parziali",
  "parzialmente",
  "passiva",
  "passive",
  "passivi",
  "passivo",
  "passo",
  "peggio",
  "pensa",
  "pensano",
  "pensare",
  "pensata",
  "pensate",
  "pensato",
  "pensi",
  "pensiamo",
  "pensiero",
  "penso",
  "per",
  "perche",
  "perch\xE9",
  "perfino",
  "permesso",
  "permette",
  "permettere",
  "permettete",
  "permetti",
  "permettiamo",
  "permetto",
  "permettono",
  "persino",
  "persona",
  "personale",
  "personali",
  "pertanto",
  "per\xF2",
  "piattaforma",
  "piccola",
  "piccole",
  "piccoli",
  "piccolo",
  "piena",
  "piene",
  "pieni",
  "pieno",
  "piuttosto",
  "pi\xF9",
  "poca",
  "poche",
  "pochi",
  "poco",
  "poiche",
  "poich\xE9",
  "pomeriggio",
  "positiva",
  "positive",
  "positivi",
  "positivo",
  "possiamo",
  "possibile",
  "possibili",
  "posso",
  "possono",
  "posto",
  "potere",
  "potete",
  "poteva",
  "potevi",
  "potevo",
  "praticamente",
  "precedentemente",
  "precisa",
  "precise",
  "precisi",
  "preciso",
  "prestazione",
  "prestazioni",
  "presto",
  "prima",
  "prime",
  "primi",
  "primo",
  "principio",
  "privata",
  "private",
  "privati",
  "privato",
  "probabilmente",
  "problema",
  "professionale",
  "professionali",
  "progetto",
  "programma",
  "prompt",
  "prova",
  "provano",
  "provare",
  "provata",
  "provate",
  "provato",
  "provi",
  "proviamo",
  "provo",
  "pubblica",
  "pubbliche",
  "pubblici",
  "pubblico",
  "punto",
  "puoi",
  "purche",
  "purch\xE9",
  "pure",
  "pu\xF2",
  "qua",
  "quaggi\xF9",
  "qualche",
  "qualcosa",
  "qualcuno",
  "quale",
  "quali",
  "qualit\xE0",
  "qualsiasi",
  "qualunque",
  "qualvolta",
  "quando",
  "quaranta",
  "quarantatr\xE9",
  "quarto",
  "quass\xF9",
  "quattordici",
  "quattro",
  "quella",
  "quelle",
  "quelli",
  "quello",
  "questa",
  "queste",
  "questi",
  "questo",
  "qui",
  "quindi",
  "quindici",
  "quinto",
  "raccomandazione",
  "raramente",
  "realmente",
  "regola",
  "requisito",
  "resta",
  "restano",
  "restare",
  "restata",
  "restate",
  "restato",
  "resti",
  "restiamo",
  "resto",
  "rete",
  "riassume",
  "riassumere",
  "riassumete",
  "riassumi",
  "riassumiamo",
  "riassumo",
  "riassumono",
  "riassunto",
  "richiede",
  "richiedere",
  "richiedete",
  "richiedi",
  "richiediamo",
  "richiedo",
  "richiedono",
  "richiesta",
  "richiesto",
  "ridondante",
  "ridondanti",
  "rilevante",
  "rilevanti",
  "rimossa",
  "rimosso",
  "rimuove",
  "rimuovere",
  "rimuovete",
  "rimuovi",
  "rimuoviamo",
  "rimuovo",
  "rimuovono",
  "risorsa",
  "risponde",
  "rispondere",
  "rispondete",
  "rispondi",
  "rispondiamo",
  "rispondo",
  "rispondono",
  "risposta",
  "risposto",
  "risultato",
  "sa",
  "sai",
  "sanno",
  "sapere",
  "sapete",
  "sapeva",
  "sapevi",
  "sapevo",
  "sappiamo",
  "sarai",
  "saranno",
  "saremo",
  "sarete",
  "sar\xE0",
  "sar\xF2",
  "sbagliata",
  "sbagliate",
  "sbagliati",
  "sbagliato",
  "schema",
  "script",
  "scritta",
  "scritto",
  "scrive",
  "scrivere",
  "scrivete",
  "scrivi",
  "scriviamo",
  "scrivo",
  "scrivono",
  "se",
  "sebbene",
  "secondo",
  "sedici",
  "sei",
  "sembra",
  "sembrano",
  "sembrare",
  "sembrate",
  "sembrato",
  "sembri",
  "sembriamo",
  "sembro",
  "semplice",
  "semplici",
  "sempre",
  "sera",
  "servizio",
  "sessanta",
  "sesto",
  "settanta",
  "sette",
  "settimana",
  "settimo",
  "sezione",
  "si",
  "siamo",
  "sicuramente",
  "sicurezza",
  "siete",
  "significativa",
  "significative",
  "significativi",
  "significativo",
  "significato",
  "sistema",
  "so",
  "societ\xE0",
  "solamente",
  "solitamente",
  "solo",
  "soltanto",
  "soluzione",
  "sono",
  "specifica",
  "specificamente",
  "specifiche",
  "specifici",
  "specifico",
  "spesso",
  "spiega",
  "spiegano",
  "spiegare",
  "spiegata",
  "spiegate",
  "spiegato",
  "spieghi",
  "spieghiamo",
  "spiego",
  "sta",
  "stai",
  "standard",
  "stanno",
  "stare",
  "stata",
  "state",
  "stati",
  "stato",
  "stava",
  "stavi",
  "stavo",
  "stessa",
  "stesse",
  "stessi",
  "stesso",
  "stiamo",
  "stile",
  "sto",
  "strato",
  "strumento",
  "struttura",
  "strutturata",
  "strutturate",
  "strutturati",
  "strutturato",
  "su",
  "sua",
  "successivamente",
  "sue",
  "suggerimento",
  "sugli",
  "sui",
  "sul",
  "sulla",
  "sulle",
  "sullo",
  "suo",
  "suoi",
  "svantaggio",
  "s\xE9",
  "talvolta",
  "tanto",
  "tardi",
  "te",
  "tecnica",
  "tecniche",
  "tecnici",
  "tecnico",
  "tempo",
  "terzo",
  "test",
  "testa",
  "testo",
  "ti",
  "tipo",
  "token",
  "tono",
  "totalmente",
  "tra",
  "tradizionale",
  "tradizionali",
  "tradotto",
  "traduce",
  "traducete",
  "traduci",
  "traduciamo",
  "traduco",
  "traducono",
  "tradurre",
  "tre",
  "tredici",
  "trenta",
  "trentatr\xE9",
  "troppo",
  "trova",
  "trovano",
  "trovare",
  "trovata",
  "trovate",
  "trovato",
  "trovi",
  "troviamo",
  "trovo",
  "tu",
  "tua",
  "tue",
  "tuo",
  "tuoi",
  "tutta",
  "tuttavia",
  "tutte",
  "tutti",
  "tutto",
  "t\xE8",
  "ultima",
  "ultime",
  "ultimi",
  "ultimo",
  "un",
  "una",
  "undici",
  "universit\xE0",
  "uno",
  "uomo",
  "usa",
  "usano",
  "usare",
  "usata",
  "usate",
  "usato",
  "usi",
  "usiamo",
  "uso",
  "utile",
  "utili",
  "utilizza",
  "utilizzano",
  "utilizzare",
  "utilizzate",
  "utilizzato",
  "utilizzi",
  "utilizziamo",
  "utilizzo",
  "va",
  "vado",
  "vai",
  "valore",
  "vanno",
  "vantaggio",
  "variabile",
  "vecchi",
  "vecchia",
  "vecchie",
  "vecchio",
  "vede",
  "vedere",
  "vedete",
  "vedeva",
  "vedevi",
  "vedevo",
  "vedi",
  "vediamo",
  "vedo",
  "vedono",
  "veloce",
  "veloci",
  "vengo",
  "vengono",
  "veniamo",
  "venire",
  "venite",
  "veniva",
  "venivi",
  "venivo",
  "venti",
  "ventitr\xE9",
  "venuta",
  "venuto",
  "vera",
  "veramente",
  "vere",
  "veri",
  "verifica",
  "verificano",
  "verificare",
  "verificate",
  "verificato",
  "verifichi",
  "verifichiamo",
  "verifico",
  "vero",
  "versione",
  "vi",
  "viene",
  "vieni",
  "vista",
  "visto",
  "vita",
  "vogliamo",
  "voglio",
  "vogliono",
  "voi",
  "volere",
  "volete",
  "voleva",
  "volevi",
  "volevo",
  "volta",
  "vostra",
  "vostre",
  "vostri",
  "vostro",
  "vuoi",
  "vuole",
  "vuota",
  "vuote",
  "vuoti",
  "vuoto",
  "zero",
  "\xE8",
  // Common verb infinitives found missing during real testing — with these
  // in place, the existing conjugation morphology (SUFFIX_RULES_IT) and
  // enclitic-pronoun stripping can derive their conjugated/enclitic forms
  // too (aiutami -> aiuta -> aiutare; guardandola -> guardando -> guardare).
  "aiutare",
  "guardare",
  "portare",
  "ascoltare",
  "mangiare",
  "bere",
  "dormire",
  "giocare",
  "lavorare",
  "studiare",
  "camminare",
  "correre",
  "saltare",
  "nuotare",
  "cantare",
  "cucinare",
  "pulire",
  "aprire",
  "chiudere",
  "mostrare",
  "spiegare",
  "insegnare",
  "imparare",
  "ricordare",
  "dimenticare",
  "pensare",
  "sperare",
  "sapere",
  "conoscere",
  "capire",
  "sentire",
  "provare",
  "cercare",
  "chiamare",
  "rispondere",
  "chiedere",
  "domandare",
  "iniziare",
  "cominciare",
  "finire",
  "terminare",
  "continuare",
  "fermare",
  "cambiare",
  "migliorare",
  "correggere",
  "controllare",
  "gestire",
  "risolvere",
  "ottenere",
  "permettere",
  "evitare",
  "raggiungere",
  "includere",
  "escludere",
  "ridurre",
  "aumentare",
  "confermare",
  "suggerire",
  "proporre",
  "valutare",
  "considerare",
  "determinare",
  "stabilire",
  // "del/dello/della" (di + article) were missing while their plural
  // (dei/degli/delle) and every other preposition+article family
  // (al/dal/nel/sul...) were already present — a narrow, specific gap
  // found via a real report ("del" flagged as misspelled in a completely
  // ordinary sentence). "rendere" was also missing — common verb, needed
  // for its enclitic form "rendilo" to resolve correctly too.
  "del",
  "dello",
  "della",
  "rendere",
  "rendi",
  // Common English tech loanwords used as-is in everyday Italian,
  // especially relevant here (a coding/writing assistant) — found via
  // "bug" being flagged as misspelled in an otherwise ordinary sentence.
  "bug",
  "software",
  "hardware",
  "computer",
  "email",
  "backup",
  "file",
  "internet",
  "app",
  "smartphone",
  "tablet",
  "laptop",
  "browser",
  "download",
  "upload",
  "login",
  "password",
  "username",
  "account",
  "cloud",
  "server",
  "database",
  "framework",
  "plugin",
  "update",
  "feedback",
  "meeting",
  "deadline",
  "business",
  "marketing",
  "budget",
  "team",
  "leader",
  "manager",
  "workshop",
  "brand",
  "target",
  "trend",
  "output",
  "input",
  "link",
  "click",
  "mouse",
  "screenshot",
  "wireless",
  "chat",
  "online",
  "offline",
  "standard",
  "test",
  "debug",
  "deploy",
  "commit",
  "merge",
  "branch",
  "repository",
  "token",
  "prompt",
  "hosting",
  "streaming",
  "podcast",
  "blog",
  "social",
  "username",
  "hashtag",
  "spam",
  // Format/technical terms — proper nouns and acronyms, not misspellings.
  // "markdown" specifically was already recognized by the PL_002 format
  // rule but not by the spell checker itself — two different mechanisms,
  // found not to be in sync via a real test.
  "markdown",
  "json",
  "html",
  "csv",
  "python",
  "javascript",
  "typescript",
  "sql",
  "css",
  "xml",
  "yaml",
  // Common everyday nouns found missing via a real report ("canzone"
  // flagged, no suggestion offered because the target word itself wasn't
  // in the dictionary for the suggestion search to find) — the earlier
  // batches added were almost all verbs; this one covers general
  // vocabulary instead.
  "canzone",
  "musica",
  "film",
  "libro",
  "storia",
  "lettera",
  "messaggio",
  "poesia",
  "articolo",
  "ricetta",
  "lista",
  "piano",
  "presentazione",
  "discorso",
  "saggio",
  "pagina",
  "immagine",
  "foto",
  "video",
  "audio",
  "grafico",
  "tabella",
  "diagramma",
  // ── Espansione mirata (v2.5.0) ──────────────────────────────────────────
  // Criterio di selezione: le regole morfologiche (incluso il nuovo
  // plurale -i→-e) derivano già le forme REGOLARI dai lemmi presenti —
  // quindi questa aggiunta privilegia ciò che la morfologia NON può
  // ricavare: (1) forme verbali irregolari ad altissima frequenza (fatto,
  // detto, visto, può, vuole…), (2) infiniti dei verbi irregolari più
  // comuni, (3) lessico quotidiano e da prompt i cui lemmi mancavano del
  // tutto. Le voci duplicate rispetto ai blocchi sopra sono innocue: il
  // Set finale deduplica.
  //
  // Verbi irregolari — presente/participio/forme tronche non derivabili:
  "fare",
  "faccio",
  "fai",
  "fa",
  "facciamo",
  "fate",
  "fanno",
  "fatto",
  "fatta",
  "fatti",
  "fatte",
  "facendo",
  "facile",
  "dire",
  "dico",
  "dici",
  "dice",
  "dicono",
  "detto",
  "detta",
  "detti",
  "dette",
  "dicendo",
  "dare",
  "d\xE0",
  "danno",
  "dato",
  "data",
  "dati",
  "date",
  "dando",
  "stare",
  "sto",
  "stai",
  "sta",
  "stiamo",
  "state",
  "stanno",
  "stato",
  "stata",
  "stati",
  "stando",
  "andare",
  "vado",
  "vai",
  "va",
  "vanno",
  "andato",
  "andata",
  "andati",
  "andando",
  "vedere",
  "vedo",
  "vedi",
  "vede",
  "vedono",
  "visto",
  "vista",
  "visti",
  "viste",
  "vedendo",
  "sapere",
  "so",
  "sai",
  "sa",
  "sappiamo",
  "sapete",
  "sanno",
  "saputo",
  "sapendo",
  "potere",
  "posso",
  "puoi",
  "pu\xF2",
  "possiamo",
  "potete",
  "possono",
  "potuto",
  "potendo",
  "potrebbe",
  "potrebbero",
  "potrei",
  "potresti",
  "potremmo",
  "volere",
  "voglio",
  "vuoi",
  "vuole",
  "vogliamo",
  "volete",
  "vogliono",
  "voluto",
  "volendo",
  "vorrei",
  "vorresti",
  "vorrebbe",
  "vorremmo",
  "dovere",
  "devo",
  "devi",
  "deve",
  "dobbiamo",
  "dovete",
  "devono",
  "dovuto",
  "dovendo",
  "dovrebbe",
  "dovrei",
  "dovresti",
  "dovremmo",
  "venire",
  "vengo",
  "vieni",
  "viene",
  "veniamo",
  "venite",
  "vengono",
  "venuto",
  "venuta",
  "venendo",
  "uscire",
  "esco",
  "esci",
  "esce",
  "usciamo",
  "uscite",
  "escono",
  "uscito",
  "mettere",
  "metto",
  "metti",
  "mette",
  "mettono",
  "messo",
  "messa",
  "messi",
  "messe",
  "mettendo",
  "prendere",
  "prendo",
  "prendi",
  "prende",
  "prendono",
  "preso",
  "presa",
  "presi",
  "prese",
  "tenere",
  "tengo",
  "tieni",
  "tiene",
  "teniamo",
  "tenete",
  "tengono",
  "tenuto",
  "scegliere",
  "scelgo",
  "scegli",
  "sceglie",
  "scelgono",
  "scelto",
  "scelta",
  "scelte",
  "scelti",
  "leggere",
  "leggo",
  "leggi",
  "legge",
  "leggono",
  "letto",
  "letta",
  "letti",
  "lette",
  "leggendo",
  "scrivere",
  "scritto",
  "scritta",
  "scritti",
  "scritte",
  "scrivendo",
  "aprire",
  "apro",
  "apri",
  "apre",
  "aprono",
  "aperto",
  "aperta",
  "aperti",
  "aperte",
  "chiudere",
  "chiudo",
  "chiudi",
  "chiude",
  "chiudono",
  "chiuso",
  "chiusa",
  "chiusi",
  "chiuse",
  "rimanere",
  "rimango",
  "rimani",
  "rimane",
  "rimangono",
  "rimasto",
  "rimasta",
  "rispondere",
  "risposto",
  "risposta",
  "risposte",
  "chiedere",
  "chiesto",
  "chiesta",
  "chieste",
  "chiesti",
  "perdere",
  "perso",
  "persa",
  "persi",
  "perse",
  "vivere",
  "vissuto",
  "morire",
  "morto",
  "nascere",
  "nato",
  "nata",
  "essere",
  "sar\xE0",
  "sar\xF2",
  "sarai",
  "saremo",
  "sarete",
  "saranno",
  "sarebbe",
  "sarebbero",
  "sia",
  "siano",
  "fosse",
  "fossero",
  "era",
  "erano",
  "eri",
  "ero",
  "eravamo",
  "eravate",
  "ha",
  "hai",
  "ho",
  "hanno",
  "abbia",
  "abbiano",
  "aveva",
  "avevano",
  "avrebbe",
  "avrebbero",
  // Funzionali/avverbi/congiunzioni mancanti:
  "gi\xE0",
  "per\xF2",
  "perci\xF2",
  "quindi",
  "allora",
  "inoltre",
  "invece",
  "mentre",
  "durante",
  "verso",
  "contro",
  "dietro",
  "davanti",
  "oltre",
  "entro",
  "presso",
  "secondo",
  "tramite",
  "attraverso",
  "nonostante",
  "malgrado",
  "siccome",
  "sebbene",
  "affinch\xE9",
  "cosicch\xE9",
  "dopo",
  "prima",
  "poi",
  "ancora",
  "sempre",
  "spesso",
  "subito",
  "insieme",
  "sopra",
  "sotto",
  "dentro",
  "fuori",
  "vicino",
  "lontano",
  "qui",
  "qua",
  "l\xEC",
  "l\xE0",
  "dove",
  "ovunque",
  "oggi",
  "domani",
  "ieri",
  "mai",
  "gi\xE0",
  "forse",
  "magari",
  "davvero",
  "quasi",
  "troppo",
  "tanto",
  "poco",
  "pochi",
  "poche",
  "parecchio",
  "abbastanza",
  "soltanto",
  "solamente",
  "solo",
  "circa",
  "almeno",
  "perfino",
  "addirittura",
  "ossia",
  "ovvero",
  "cio\xE8",
  "infatti",
  "dunque",
  "pertanto",
  "tuttavia",
  "comunque",
  "eppure",
  "neanche",
  "nemmeno",
  "neppure",
  "niente",
  "nulla",
  "nessuno",
  "nessuna",
  "qualcosa",
  "qualcuno",
  "qualche",
  "ogni",
  "ognuno",
  "ognuna",
  "tutto",
  "tutta",
  "tutti",
  "tutte",
  "ciascuno",
  "ciascuna",
  "entrambi",
  "entrambe",
  "stesso",
  "stessa",
  "stessi",
  "stesse",
  "proprio",
  "propria",
  "propri",
  "proprie",
  "tale",
  "tali",
  "quale",
  "quali",
  "quanto",
  "quanta",
  "quanti",
  "quante",
  // Famiglia -zione/-sione: i singolari bastano, i plurali in -i ora
  // derivano dalla regola [/i$/,'e'] (vedi spell/index.ts):
  "situazione",
  "operazione",
  "organizzazione",
  "relazione",
  "posizione",
  "creazione",
  "gestione",
  "attenzione",
  "intenzione",
  "riunione",
  "decisione",
  "discussione",
  "dimensione",
  "connessione",
  "sessione",
  "estensione",
  "eccezione",
  "conclusione",
  "introduzione",
  "traduzione",
  "produzione",
  "riduzione",
  "espressione",
  "impressione",
  "opinione",
  "questione",
  "ragione",
  "regione",
  "stagione",
  "visione",
  "revisione",
  "missione",
  "emozione",
  "azione",
  "reazione",
  "nazione",
  "spiegazione",
  "valutazione",
  "generazione",
  "correzione",
  "integrazione",
  "installazione",
  "implementazione",
  "documentazione",
  "autenticazione",
  "registrazione",
  "navigazione",
  "notifica",
  // Lessico quotidiano e da prompt (lemmi; le flessioni regolari derivano):
  "tempo",
  "volta",
  "volte",
  "modo",
  "parte",
  "punto",
  "esempio",
  "problema",
  "problemi",
  "sistema",
  "sistemi",
  "programma",
  "programmi",
  "progetto",
  "processo",
  "risultato",
  "obiettivo",
  "dettaglio",
  "elemento",
  "livello",
  "numero",
  "valore",
  "nome",
  "titolo",
  "testo",
  "parola",
  "riga",
  "errore",
  "errori",
  "prova",
  "senso",
  "tipo",
  "tipi",
  "forma",
  "base",
  "dato",
  "idea",
  "idee",
  "area",
  "tema",
  "temi",
  "serie",
  "specie",
  "mondo",
  "paese",
  "paesi",
  "persona",
  "persone",
  "uomo",
  "uomini",
  "donna",
  "donne",
  "giorno",
  "giorni",
  "notte",
  "mattina",
  "sera",
  "settimana",
  "settimane",
  "ora",
  "ore",
  "minuto",
  "secondo",
  "secondi",
  "momento",
  "momenti",
  "luogo",
  "luoghi",
  "strada",
  "strade",
  "porta",
  "porte",
  "finestra",
  "finestre",
  "tavolo",
  "sedia",
  "stanza",
  "cucina",
  "bagno",
  "macchina",
  "treno",
  "aereo",
  "telefono",
  "telefonata",
  "domanda",
  "domande",
  "risposta",
  "risposte",
  "lavoro",
  "lavori",
  "scuola",
  "universit\xE0",
  "studente",
  "studenti",
  "insegnante",
  "professore",
  "medico",
  "dottore",
  "cliente",
  "clienti",
  "utente",
  "utenti",
  "prodotto",
  "prodotti",
  "servizio",
  "servizi",
  "mercato",
  "prezzo",
  "prezzi",
  "costo",
  "costi",
  "denaro",
  "soldi",
  "euro",
  "governo",
  "legge",
  "leggi",
  "diritto",
  "diritti",
  "guerra",
  "pace",
  "salute",
  "malattia",
  "corpo",
  "testa",
  "mano",
  "mani",
  "occhio",
  "occhi",
  "piede",
  "piedi",
  "cuore",
  "mente",
  "voce",
  "voci",
  "aria",
  "acqua",
  "fuoco",
  "terra",
  "cielo",
  "sole",
  "luna",
  "mare",
  "montagna",
  "fiume",
  "albero",
  "alberi",
  "fiore",
  "fiori",
  "animale",
  "animali",
  "cane",
  "gatto",
  "cibo",
  "pane",
  "vino",
  "frutta",
  "verdura",
  "carne",
  "pesce",
  "colore",
  "colori",
  "rosso",
  "rossa",
  "verde",
  "verdi",
  "blu",
  "giallo",
  "gialla",
  "bianco",
  "bianca",
  "nero",
  "nera",
  "grigio",
  "grigia",
  "grande",
  "grandi",
  "piccolo",
  "piccola",
  "piccoli",
  "piccole",
  "lungo",
  "lunga",
  "lunghi",
  "lunghe",
  "corto",
  "corta",
  "largo",
  "larga",
  "stretto",
  "stretta",
  "alto",
  "basso",
  "nuovo",
  "nuova",
  "nuovi",
  "nuove",
  "vecchio",
  "vecchia",
  "giovane",
  "giovani",
  "facile",
  "facili",
  "difficile",
  "difficili",
  "possibile",
  "possibili",
  "impossibile",
  "veloce",
  "veloci",
  "lento",
  "lenta",
  "semplice",
  "semplici",
  "complesso",
  "complessa",
  "giusto",
  "giusta",
  "sbagliato",
  "sbagliata",
  "vero",
  "vera",
  "veri",
  "vere",
  "falso",
  "falsa",
  "pieno",
  "piena",
  "vuoto",
  "vuota",
  "forte",
  "forti",
  "debole",
  "deboli",
  "leggero",
  "leggera",
  "pesante",
  "pesanti",
  "migliore",
  "migliori",
  "peggiore",
  "peggiori",
  "maggiore",
  "maggiori",
  "minore",
  "minori",
  "ultimo",
  "ultima",
  "ultimi",
  "ultime",
  "primo",
  "prima",
  "primi",
  "prime",
  "terzo",
  "terza",
  "quarto",
  "quinto",
  "sesto",
  "settimo",
  "ottavo",
  "nono",
  "decimo",
  "doppio",
  "doppia",
  "mezzo",
  "mezza",
  "intero",
  "intera",
  "unico",
  "unica",
  "unici",
  "uniche",
  "diverso",
  "diversa",
  "diversi",
  "diverse",
  "uguale",
  "uguali",
  "simile",
  "simili",
  "comune",
  "comuni",
  "normale",
  "normali",
  "speciale",
  "speciali",
  "generale",
  "generali",
  "particolare",
  "particolari",
  "principale",
  "principali",
  "importanza",
  "interessante",
  "interessanti",
  "utile",
  "utili",
  "inutile",
  "necessario",
  "necessaria",
  "necessari",
  "necessarie",
  "sufficiente",
  "disponibile",
  "disponibili",
  "gratuito",
  "gratuita",
  "sicuro",
  "sicura",
  "sicuri",
  "sicure",
  "pericoloso",
  "pericolosa",
  "felice",
  "felici",
  "triste",
  "tristi",
  "contento",
  "contenta",
  "stanco",
  "stanca",
  "pronto",
  "pronta",
  "pronti",
  "pronte",
  "aperto",
  "chiuso",
  "caro",
  "cara",
  "economico",
  "economica"
];
var DICTIONARY_IT = new Set(DICTIONARY_WORDS_IT);

// src/spell/language.ts
var IT_SIGNALS = /* @__PURE__ */ new Set([
  "il",
  "lo",
  "la",
  "i",
  "gli",
  "le",
  "un",
  "uno",
  "una",
  "dei",
  "degli",
  "delle",
  "di",
  "da",
  "in",
  "con",
  "su",
  "per",
  "tra",
  "fra",
  "che",
  "non",
  "\xE8",
  "sono",
  "questo",
  "questa",
  "questi",
  "queste",
  "quello",
  "quella",
  "molto",
  "pi\xF9",
  "anche",
  "come",
  "quando",
  "dove",
  "perch\xE9",
  "perche",
  "mio",
  "tuo",
  "suo",
  "nostro",
  "vostro",
  "loro",
  "io",
  "tu",
  "lui",
  "lei",
  "noi",
  "voi",
  "si",
  "ci",
  "al",
  "allo",
  "alla",
  "ai",
  "agli",
  "alle",
  "dal",
  "dallo",
  "dalla",
  "nel",
  "nella",
  "sul",
  "sulla",
  "ma",
  "se",
  "del",
  "della",
  "dello",
  "con",
  "senza"
]);
var EN_SIGNALS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "and",
  "is",
  "are",
  "that",
  "this",
  "these",
  "those",
  "very",
  "more",
  "also",
  "as",
  "when",
  "where",
  "why",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "it",
  "with",
  "without",
  "for",
  "on",
  "at",
  "by",
  "from",
  "but",
  "if",
  "not"
]);
function detectLanguage(text, previousLang, threshold = 0.7) {
  const fallback = previousLang ?? "en";
  if (!text || text.trim().length < 3) return fallback;
  const words = text.toLowerCase().match(/[a-zà-ù']+/g) ?? [];
  if (words.length === 0) return fallback;
  let itScore = 0;
  let enScore = 0;
  for (const w of words) {
    if (IT_SIGNALS.has(w)) itScore++;
    if (EN_SIGNALS.has(w)) enScore++;
  }
  const itPatternHits = (text.match(/[àèéìòù]|zione\b|mente\b/gi) ?? []).length;
  itScore += itPatternHits * 0.5;
  const total = itScore + enScore;
  if (total === 0) return fallback;
  const itShare = itScore / total;
  const enShare = enScore / total;
  if (itShare >= threshold) return "it";
  if (enShare >= threshold) return "en";
  return fallback;
}

// src/spell/index.ts
var WORD_LETTER = "a-zA-Z\xC0-\xD6\xD8-\xF6\xF8-\xFF";
function wordRegex() {
  return new RegExp(`[${WORD_LETTER}][${WORD_LETTER}']*[${WORD_LETTER}]|[${WORD_LETTER}]`, "g");
}
function isWordChar(ch) {
  return new RegExp(`[${WORD_LETTER}']`).test(ch);
}
function wholeWord(pattern, flags = "gi") {
  return new RegExp(`(?<![${WORD_LETTER}])(?:${pattern})(?![${WORD_LETTER}])`, flags);
}
var ABBREVIATIONS = /* @__PURE__ */ new Set([
  "api",
  "url",
  "uri",
  "http",
  "https",
  "html",
  "css",
  "js",
  "ts",
  "jsx",
  "tsx",
  "sql",
  "json",
  "xml",
  "yaml",
  "csv",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "svg",
  "gif",
  "ai",
  "ml",
  "nlp",
  "llm",
  "gpt",
  "rag",
  "gpu",
  "cpu",
  "ram",
  "sdk",
  "ide",
  "cli",
  "gui",
  "ui",
  "ux",
  "mvp",
  "saas",
  "cdn",
  "dns",
  "ip",
  "tcp",
  "uuid",
  "id",
  "db",
  "orm",
  "mvc",
  "ci",
  "cd",
  "pr",
  "mr",
  "env",
  "dev",
  "prod",
  "qa",
  "poc",
  "nb",
  "aka",
  "etc",
  "vs",
  "eg",
  "ie",
  "todo",
  "fixme",
  "bert",
  "rlhf",
  "lol",
  "omg",
  "asap",
  "fyi",
  "tbd",
  "tbc",
  "wip",
  "imo",
  "imho",
  "afaik",
  "btw",
  "diy",
  "faq",
  "eta",
  "kpi",
  "roi",
  "sla",
  "agi",
  "asi",
  "p0",
  "p1",
  "p2"
]);
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (a === b) return 0;
  let row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : 1 + Math.min(row[j - 1], row[j], prev);
      row[j - 1] = prev;
      prev = val;
    }
    row[n] = prev;
  }
  return row[n];
}
var SUFFIX_RULES_EN = [
  [/ing$/, ""],
  [/ing$/, "e"],
  [/ying$/, "y"],
  [/ied$/, "y"],
  [/ed$/, ""],
  [/ed$/, "e"],
  [/ies$/, "y"],
  [/ves$/, "f"],
  [/ses$/, "s"],
  [/es$/, ""],
  [/s$/, ""],
  [/ier$/, "y"],
  [/iest$/, "y"],
  [/er$/, ""],
  [/er$/, "e"],
  [/est$/, ""],
  [/est$/, "e"],
  [/ly$/, ""],
  [/ness$/, ""],
  [/ment$/, ""],
  [/ment$/, "e"],
  [/tion$/, ""],
  [/tion$/, "e"],
  [/sion$/, ""],
  [/ation$/, ""],
  [/ation$/, "e"],
  [/able$/, ""],
  [/ible$/, ""],
  [/ful$/, ""],
  [/less$/, ""],
  [/al$/, ""],
  [/ical$/, ""],
  [/ize$/, ""],
  [/ise$/, ""],
  [/ify$/, ""]
];
var SUFFIX_RULES_IT = [
  // Gender/number: o/a/i/e endings on nouns and adjectives.
  // [/i$/, 'e'] added after a real, demonstrated gap: the entire class of
  // -e nouns/adjectives pluralizes in -i (funzione→funzioni,
  // versione→versioni, importante→importanti), and nothing here derived
  // that singular back — so "funzioni", "opzioni", "informazioni",
  // "condizioni" were ALL flagged as misspelled unless individually
  // enumerated in the dictionary. Especially bad for prompt-writing
  // vocabulary, where the -zione/-zioni family is everywhere. Like every
  // other rule here, it only generates a *candidate* checked against the
  // dictionary, so it can't create false negatives on non-words.
  [/i$/, "o"],
  [/i$/, "e"],
  [/e$/, "a"],
  [/he$/, "ca"],
  [/he$/, "ga"],
  [/ci$/, "co"],
  [/gi$/, "go"],
  // Adverbs -mente → adjective
  [/mente$/, ""],
  [/mente$/, "e"],
  // Bare 3rd-person-singular present tense ("aiuta" -> "aiutare", "vede" is
  // already covered by e$->a above by coincidence for -ere, so this mainly
  // adds the -are case that nothing else caught). Generates some false
  // candidate roots for words ending in plain -a/-e that aren't verbs at
  // all (e.g. "casa" -> "casare") — harmless, since these are just
  // candidates checked against the dictionary, not assumed correct.
  [/a$/, "are"],
  // Common verb infinitive endings from conjugated forms (1st conj. -are)
  [/iamo$/, "are"],
  [/ate$/, "are"],
  [/ano$/, "are"],
  [/avo$/, "are"],
  [/avi$/, "are"],
  [/ava$/, "are"],
  [/avamo$/, "are"],
  [/avate$/, "are"],
  [/avano$/, "are"],
  [/ato$/, "are"],
  [/ata$/, "are"],
  [/ati$/, "are"],
  [/ate$/, "are"],
  [/erò$/, "are"],
  [/erai$/, "are"],
  [/erà$/, "are"],
  // 2nd conj. -ere
  [/iamo$/, "ere"],
  [/ete$/, "ere"],
  [/ono$/, "ere"],
  [/evo$/, "ere"],
  [/evi$/, "ere"],
  [/eva$/, "ere"],
  [/uto$/, "ere"],
  [/uta$/, "ere"],
  [/uti$/, "ere"],
  [/ute$/, "ere"],
  // 3rd conj. -ire
  [/iamo$/, "ire"],
  [/ite$/, "ire"],
  [/ono$/, "ire"],
  [/ivo$/, "ire"],
  [/ivi$/, "ire"],
  [/iva$/, "ire"],
  [/ito$/, "ire"],
  [/ita$/, "ire"],
  [/iti$/, "ire"],
  [/ite$/, "ire"],
  [/isco$/, "ire"],
  [/isci$/, "ire"],
  [/isce$/, "ire"],
  [/iscono$/, "ire"],
  // Gerund: -ando (1st conj.), -endo (2nd/3rd conj.)
  [/ando$/, "are"],
  [/endo$/, "ere"],
  [/endo$/, "ire"],
  // Present participle / agent nouns: -ante, -ente
  [/ante$/, "are"],
  [/ente$/, "ere"],
  [/ente$/, "ire"],
  [/ino$/, ""],
  [/ina$/, ""],
  [/etto$/, ""],
  [/etta$/, ""],
  [/one$/, ""],
  [/ona$/, ""]
];
var ENCLITICS_IT = [
  "gliela",
  "glieli",
  "gliele",
  "gliene",
  "glielo",
  "mela",
  "meli",
  "mele",
  "mene",
  "melo",
  "tela",
  "teli",
  "tele",
  "tene",
  "telo",
  "cela",
  "celi",
  "cele",
  "cene",
  "celo",
  "vela",
  "veli",
  "vele",
  "vene",
  "velo",
  "sela",
  "seli",
  "sele",
  "sene",
  "selo",
  "gli",
  "mi",
  "ti",
  "ci",
  "vi",
  "si",
  "lo",
  "la",
  "li",
  "le",
  "ne"
];
function deriveEncliticRootsIT(word) {
  const roots = [];
  for (const suffix of ENCLITICS_IT) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 3) continue;
    const stripped = word.slice(0, -suffix.length);
    roots.push(stripped);
    roots.push(stripped + "e");
  }
  return roots;
}
function deriveRoots(word, lang) {
  const rules = lang === "it" ? SUFFIX_RULES_IT : SUFFIX_RULES_EN;
  const roots = [];
  for (const [suffix, rep] of rules) {
    if (suffix.test(word)) {
      const root = word.replace(suffix, rep);
      if (root.length >= 2) roots.push(root);
    }
  }
  if (lang === "it") {
    const encliticRoots = deriveEncliticRootsIT(word);
    roots.push(...encliticRoots);
    for (const r of encliticRoots) {
      for (const [suffix, rep] of SUFFIX_RULES_IT) {
        if (suffix.test(r)) {
          const root2 = r.replace(suffix, rep);
          if (root2.length >= 2) roots.push(root2);
        }
      }
    }
  }
  return roots;
}
var CONTRACTIONS_EN = {
  "don't": "do",
  "doesn't": "does",
  "didn't": "did",
  "won't": "will",
  "can't": "can",
  "couldn't": "could",
  "wouldn't": "would",
  "shouldn't": "should",
  "isn't": "is",
  "aren't": "are",
  "wasn't": "was",
  "weren't": "were",
  "haven't": "have",
  "hasn't": "has",
  "hadn't": "had",
  "i'm": "i",
  "i've": "i",
  "i'll": "i",
  "i'd": "i",
  "you're": "you",
  "it's": "it",
  "let's": "let",
  "that's": "that",
  "there's": "there",
  "they're": "they",
  "we're": "we",
  "he's": "he",
  "she's": "she"
};
function getDictionary(lang) {
  return lang === "it" ? DICTIONARY_IT : DICTIONARY;
}
var INDEFINITE_ROOTS_EN = ["some", "any", "every", "no"];
var INDEFINITE_SUFFIXES_EN = ["thing", "one", "body", "where", "how"];
var EVER_WORDS_EN = /* @__PURE__ */ new Set(["whatever", "whenever", "wherever", "whoever", "whichever", "however"]);
function isIndefiniteCompoundEN(lower) {
  if (EVER_WORDS_EN.has(lower)) return true;
  for (const root of INDEFINITE_ROOTS_EN) {
    if (!lower.startsWith(root)) continue;
    if (INDEFINITE_SUFFIXES_EN.includes(lower.slice(root.length))) return true;
  }
  return false;
}
function isCorrect(word, lang = "en") {
  if (!word || word.length <= 1) return true;
  const lower = word.toLowerCase();
  if (/^\d+([.,]\d+)?$/.test(word)) return true;
  if (/^\d+(st|nd|rd|th|°|º)$/i.test(word)) return true;
  if (/^[A-Z]{2,}$/.test(word)) return true;
  if (/[a-z][A-Z]/.test(word)) return true;
  if (ABBREVIATIONS.has(lower)) return true;
  if (lang === "en" && isIndefiniteCompoundEN(lower)) return true;
  const dict = getDictionary(lang);
  if (lang === "en" && CONTRACTIONS_EN[lower] && DICTIONARY.has(CONTRACTIONS_EN[lower])) return true;
  if (dict.has(lower)) return true;
  const dep = lower.replace(/'s$/, "").replace(/'$/, "");
  if (dep !== lower && dict.has(dep)) return true;
  if (lower.includes("-")) {
    const parts = lower.split("-");
    if (parts.every((p) => !p || dict.has(p) || /^\d+$/.test(p))) return true;
  }
  if (deriveRoots(lower, lang).some((r) => dict.has(r))) return true;
  if (/(.)\1(ing|ed|er|est)$/.test(lower)) {
    const dd = lower.replace(/(.)\1(ing|ed|er|est)$/, "$1$2");
    if (dict.has(dd) || deriveRoots(dd, lang).some((r) => dict.has(r))) return true;
  }
  return false;
}
function getSuggestions(word, max = 5, lang = "en") {
  const lower = word.toLowerCase();
  if (isCorrect(lower, lang)) return [];
  const dict = getDictionary(lang);
  const minLen = Math.max(1, lower.length - 3);
  const maxLen = lower.length + 3;
  const candidates = [];
  for (const dictWord of dict) {
    if (dictWord.length < minLen || dictWord.length > maxLen) continue;
    const dist = levenshtein(lower, dictWord);
    if (dist <= 3) candidates.push({ word: dictWord, dist });
  }
  const first = lower[0];
  return candidates.sort(
    (a, b) => a.dist - b.dist || Number(b.word[0] === first) - Number(a.word[0] === first) || Math.abs(a.word.length - lower.length) - Math.abs(b.word.length - lower.length) || a.word.localeCompare(b.word)
  ).slice(0, max).map((c) => c.word);
}

// src/spell/adapters/SpellAdapter.ts
var ALWAYS_SKIP = /^([A-Z]{2,}|\d|https?:\/\/)/;
var TECH_TERMS = /* @__PURE__ */ new Set([
  "async",
  "await",
  "const",
  "let",
  "var",
  "func",
  "def",
  "lambda",
  "enum",
  "struct",
  "null",
  "undefined",
  "nan",
  "void",
  "bool",
  "boolean",
  "int",
  "float",
  "string",
  "array",
  "object",
  "promise",
  "callback",
  "closure",
  "middleware",
  "endpoint",
  "backend",
  "frontend",
  "fullstack",
  "runtime",
  "compiler",
  "linter",
  "bundler",
  "dataset",
  "pipeline",
  "filtering",
  "mapping",
  "parsing",
  "caching",
  "logging",
  "debugging",
  "refactoring",
  "deployment",
  "commit",
  "merge",
  "rebase",
  "branch",
  "repo",
  "repository",
  "fetch",
  "render",
  "props",
  "state",
  "hook",
  "hooks",
  "component",
  "template",
  "schema",
  "query",
  "mutation",
  "subscription",
  "regex",
  "boolean",
  "timestamp",
  "uuid",
  "token",
  "payload",
  "webhook",
  "cron",
  "stdout",
  "stdin",
  "stderr",
  "env",
  "config",
  "localhost",
  "wildcard",
  "namespace",
  "iterator",
  "generator",
  "decorator",
  "annotation",
  "serialization",
  "deserialization",
  "react",
  "vue",
  "svelte",
  "angular",
  "node",
  "deno",
  "bun",
  "webpack",
  "vite",
  "docker",
  "kubernetes",
  "nginx",
  "redis",
  "postgres",
  "mongodb",
  "graphql",
  "typescript",
  "javascript",
  "python",
  "golang",
  "rust",
  "kotlin",
  "swift",
  "conversion",
  "wishlist",
  "workflow",
  "changelog",
  "readme",
  "gitignore",
  "serverless",
  "stateless",
  "stateful",
  "serverside",
  "clientside",
  "microservice",
  "microservices",
  "devops",
  "sysadmin",
  "oauth",
  "websocket",
  "graphql",
  "nosql",
  "frontend",
  "backend",
  "fullstack",
  "middleware",
  "codebase",
  "boilerplate",
  "linting",
  "formatter",
  "transpiler",
  "polyfill",
  "shim",
  "monorepo",
  "changeset"
]);
function shouldSkipWord(word) {
  if (word.length <= 1) return true;
  if (ALWAYS_SKIP.test(word)) return true;
  if (/[A-ZÀ-Ö]/.test(word.slice(1))) return true;
  const lower = word.toLowerCase();
  if (TECH_TERMS.has(lower)) return true;
  const ABBREV = /* @__PURE__ */ new Set([
    "api",
    "url",
    "http",
    "https",
    "html",
    "css",
    "js",
    "ts",
    "jsx",
    "tsx",
    "sql",
    "json",
    "xml",
    "yaml",
    "csv",
    "pdf",
    "ai",
    "ml",
    "llm",
    "gpt",
    "rag",
    "gpu",
    "cpu",
    "sdk",
    "ide",
    "cli",
    "gui",
    "ui",
    "ux",
    "db",
    "orm",
    "ci",
    "cd",
    "jwt",
    "uuid",
    "id",
    "nb",
    "aka",
    "etc",
    "vs",
    "eg",
    "ie",
    "lol",
    "asap",
    "fyi",
    "tbd",
    "imo",
    "imho",
    "afaik",
    "btw",
    "faq",
    "kpi",
    "agi",
    "asi",
    "bert",
    "rlhf"
  ]);
  return ABBREV.has(lower);
}

// src/analyzers/observations.ts
function nextId() {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `obs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }
}
function getLineCol(text, offset) {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}
var _inputPricePerMillion = 2.5;
function impact(tokensSaved) {
  const costPer1k = tokensSaved / 1e6 * _inputPricePerMillion * 1e3;
  return {
    tokensSaved,
    impact: tokensSaved >= 10 ? "high" : tokensSaved >= 3 ? "medium" : tokensSaved >= 1 ? "low" : "none",
    costSavedPer1kCalls: Math.round(costPer1k * 1e5) / 1e5
  };
}
function obs(type, level, label2, matchText, offset, text, why, suggestion, example, tokensSaved, code) {
  const { line, column } = getLineCol(text, offset);
  return {
    id: nextId(),
    type,
    level,
    label: label2,
    matchText,
    offset,
    length: matchText.length,
    line,
    column,
    why,
    suggestion,
    example,
    impact: impact(tokensSaved),
    code
  };
}
function runSpell(text, spell, detectedLang) {
  const results = [];
  const re = /[a-zA-Zà-ÿ][a-zA-Zà-ÿ']*[a-zA-Zà-ÿ]|[a-zA-Zà-ÿ]/g;
  let m;
  const seen = /* @__PURE__ */ new Map();
  const codeRanges = [];
  const fence = /```[\s\S]*?```|`[^`\n]*`/g;
  let cm;
  while ((cm = fence.exec(text)) !== null) codeRanges.push([cm.index, cm.index + cm[0].length]);
  const inCode = (pos) => codeRanges.some(([s, e]) => pos >= s && pos < e);
  const fallbackLang = detectedLang;
  while ((m = re.exec(text)) !== null) {
    const word = m[0];
    if (inCode(m.index)) continue;
    const before = m.index > 0 ? text[m.index - 1] : "";
    const after = text[m.index + word.length] ?? "";
    const afterNext = text[m.index + word.length + 1] ?? "";
    const beforePrev = m.index > 1 ? text[m.index - 2] : "";
    const isPathish = before === "/" || before === "\\" || after === "/" || after === "\\" || after === "." && /[a-zA-Zà-ÿ]/.test(afterNext) || // Button.tsx
    before === "." && /[a-zA-Zà-ÿ]/.test(beforePrev);
    if (isPathish) continue;
    if (shouldSkipWord(word)) continue;
    const correct = spell ? spell.correct(word) : isCorrect(word, fallbackLang);
    if (correct) continue;
    const lower = word.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, spell ? spell.suggest(lower, 4) : getSuggestions(lower, 4, fallbackLang));
    }
    const suggs = seen.get(lower);
    const isItalian = !spell && fallbackLang === "it";
    results.push(obs(
      "spelling",
      "unnecessary",
      "\u{1F4A1} Spelling",
      word,
      m.index,
      text,
      isItalian ? `"${word}" non risulta nel dizionario. Le parole errate possono confondere il modello e sprecare token su una forma non riconosciuta.` : `"${word}" doesn't appear in the dictionary. Misspelled words can confuse the model and waste tokens on an unrecognized form.`,
      suggs.length > 0 ? isItalian ? `Forse intendevi: ${suggs.join(", ")}?` : `Did you mean: ${suggs.join(", ")}?` : isItalian ? "Controlla l'ortografia di questa parola." : "Check the spelling of this word.",
      suggs.length > 0 ? { before: word, after: suggs[0] } : null,
      0,
      "SPELL_001"
    ));
  }
  return results;
}
function runRepeatedWord(text) {
  const results = [];
  const re = /\b(\w+)\s+\1\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push(obs(
      "repetition",
      "unnecessary",
      "\u{1F4A1} Ripetizione",
      m[0],
      m.index,
      text,
      `La parola "${m[1]}" appare due volte di fila. \xC8 quasi sempre un refuso che pu\xF2 confondere il modello sull'intenzione reale.`,
      `Rimuovi una delle due occorrenze di "${m[1]}".`,
      { before: m[0], after: m[1] },
      estimateTokens(m[1]),
      "GRAM_001"
    ));
  }
  return results;
}
function runDoubleNegation(text, detectedLang) {
  if (detectedLang !== "en") return [];
  const results = [];
  const negs = ["not", "no", "never", "neither", "nor", "nothing", "nobody", "nowhere", "none"];
  const re = new RegExp(
    `\\b(${negs.join("|")})\\b[^.!?]{1,30}?\\b(${negs.join("|")})\\b`,
    "gi"
  );
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push(obs(
      "double_negation",
      "contradiction",
      "\u{1F534} Doppia negazione",
      m[0],
      m.index,
      text,
      `"${m[1]}" e "${m[2]}" sono due negazioni nella stessa frase. I modelli LLM interpretano le doppie negazioni in modo imprevedibile \u2014 a volte si annullano, a volte no.`,
      "Riscrivi la frase usando una sola negazione chiara, o formula in positivo.",
      { before: m[0], after: "(riformulare in positivo)" },
      0,
      "GRAM_002"
    ));
  }
  return results;
}
function runLongSentence(text) {
  const results = [];
  const sentences = text.split(/(?<=[.!?])\s+|(?<=[.!?])$/);
  let cursor = 0;
  for (const sentence of sentences) {
    const foundAt = text.indexOf(sentence, cursor);
    const offset = foundAt === -1 ? cursor : foundAt;
    const wordCount2 = (sentence.match(/\b\w+\b/g) ?? []).length;
    if (wordCount2 > 35) {
      const tok = estimateTokens(sentence);
      results.push(obs(
        "long_sentence",
        "improvable",
        "\u{1F7E1} Frase lunga",
        sentence.slice(0, 60) + (sentence.length > 60 ? "\u2026" : ""),
        offset,
        text,
        `Questa frase contiene ${wordCount2} parole. Frasi molto lunghe sono pi\xF9 difficili da parsare per il modello e spesso contengono istruzioni ridondanti.`,
        "Dividi in 2\u20133 frasi pi\xF9 brevi, ognuna con un'istruzione singola.",
        { before: sentence.slice(0, 50) + "\u2026", after: "(dividere in istruzioni separate)" },
        Math.round(tok * 0.15),
        "GRAM_003"
      ));
    }
    cursor = offset + sentence.length;
  }
  return results;
}
function runMultipleSpaces(text) {
  const results = [];
  const re = / {2,}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push(obs(
      "grammar",
      "unnecessary",
      "\u{1F7E0} Spazi multipli",
      m[0],
      m.index,
      text,
      `${m[0].length} spazi consecutivi. Ogni spazio aggiuntivo spreca token e pu\xF2 interferire con parser di output strutturato.`,
      "Sostituisci con un singolo spazio.",
      { before: m[0], after: " " },
      m[0].length - 1,
      "GRAM_004"
    ));
  }
  return results;
}
var FILLERS = [
  { re: /\bbasically\b/gi, why: '"basically" non aggiunge significato alle istruzioni.', save: 1, code: "FILL_001" },
  { re: /\bessentially\b/gi, why: '"essentially" \xE8 un intensificatore vuoto che non informa il modello.', save: 1, code: "FILL_002" },
  { re: /\bliterally\b/gi, why: '"literally" raramente modifica il comportamento del modello.', save: 1, code: "FILL_003" },
  { re: /\bactually\b/gi, why: `"actually" non aggiunge valore semantico in un'istruzione.`, save: 1, code: "FILL_004" },
  { re: /\bjust\b/gi, why: `"just" indebolisce l'istruzione senza aggiungere precisione.`, save: 1, code: "FILL_005" },
  { re: /\bsimply\b/gi, why: '"simply" \xE8 ridondante: il modello non sa se sia facile o difficile.', save: 1, code: "FILL_006" },
  { re: /\bvery\b/gi, why: '"very" \xE8 un intensificatore vago. Preferisci un aggettivo pi\xF9 forte o rimuovilo.', save: 1, code: "FILL_007" },
  { re: /\breally\b/gi, why: '"really" non aggiunge informazioni utili al modello.', save: 1, code: "FILL_008" },
  { re: /\bquite\b/gi, why: '"quite" \xE8 un qualificatore vago \u2014 il modello non pu\xF2 misurarlo.', save: 1, code: "FILL_009" },
  { re: /\bkind of\b/gi, why: `"kind of" crea ambiguit\xE0: il modello non sa quanto applicare l'istruzione.`, save: 1, code: "FILL_010" },
  { re: /\bsort of\b/gi, why: `"sort of" crea ambiguit\xE0 nell'istruzione.`, save: 1, code: "FILL_011" },
  // ── Italiano (serie FILL_1xx) ── Prima di questa aggiunta, TUTTE le
  // regole di questa famiglia erano pattern inglesi: un utente italiano
  // riceveva solo ortografia + regole strutturali, mai il valore vero del
  // linter. Solo filler sicuri e privi di ambiguità — parole che in un
  // prompt non cambiano mai il significato dell'istruzione.
  { re: /\bpraticamente\b/gi, why: `"praticamente" non aggiunge significato a un'istruzione.`, save: 1, code: "FILL_101" },
  { re: /\bfondamentalmente\b/gi, why: '"fondamentalmente" \xE8 un intensificatore vuoto che non informa il modello.', save: 1, code: "FILL_102" },
  { re: /\bsostanzialmente\b/gi, why: '"sostanzialmente" non modifica il comportamento del modello.', save: 1, code: "FILL_103" },
  { re: /\bin pratica\b/gi, why: `"in pratica" \xE8 un riempitivo: l'istruzione resta identica senza.`, save: 1, code: "FILL_104" },
  { re: /\bin sostanza\b/gi, why: '"in sostanza" \xE8 un riempitivo che non aggiunge precisione.', save: 1, code: "FILL_105" },
  { re: /\bletteralmente\b/gi, why: '"letteralmente" raramente modifica il comportamento del modello.', save: 1, code: "FILL_106" },
  { re: /\bsemplicemente\b/gi, why: '"semplicemente" \xE8 ridondante: il modello non sa se sia facile o difficile.', save: 1, code: "FILL_107" },
  { re: /\bdiciamo che\b/gi, why: `"diciamo che" crea ambiguit\xE0: il modello non sa quanto prendere alla lettera l'istruzione.`, save: 2, code: "FILL_108" }
];
function runFillers(text) {
  const results = [];
  for (const { re, why, save, code } of FILLERS) {
    const pattern = new RegExp(re.source, re.flags);
    let m;
    while ((m = pattern.exec(text)) !== null) {
      results.push(obs(
        "filler",
        "unnecessary",
        "\u{1F7E0} Parola inutile",
        m[0],
        m.index,
        text,
        why,
        `Rimuovi "${m[0]}" \u2014 il prompt rimane identico nel significato.`,
        { before: m[0], after: "(rimuovere)" },
        save,
        code
      ));
    }
  }
  return results;
}
var VERBOSE = [
  { re: /\bin order to\b/gi, rep: "to", save: 2, why: '"in order to" \xE8 una costruzione verbosa. "to" trasmette lo stesso significato con meno token.', code: "VERB_001" },
  { re: /\bdue to the fact that\b/gi, rep: "because", save: 4, why: '"due to the fact that" usa 5 parole dove basta "because".', code: "VERB_002" },
  { re: /\bin the event that\b/gi, rep: "if", save: 3, why: '"in the event that" usa 4 parole dove basta "if".', code: "VERB_003" },
  { re: /\bat this point in time\b/gi, rep: "now", save: 4, why: '"at this point in time" usa 5 parole dove basta "now".', code: "VERB_004" },
  { re: /\bfor the purpose of\b/gi, rep: "to", save: 3, why: '"for the purpose of" usa 4 parole dove basta "to".', code: "VERB_005" },
  { re: /\bhas the ability to\b/gi, rep: "can", save: 3, why: '"has the ability to" usa 4 parole dove basta "can".', code: "VERB_006" },
  { re: /\bis able to\b/gi, rep: "can", save: 2, why: '"is able to" usa 3 parole dove basta "can".', code: "VERB_007" },
  { re: /\bwith regard to\b/gi, rep: "about", save: 2, why: '"with regard to" usa 3 parole dove basta "about".', code: "VERB_008" },
  { re: /\bdue to\b/gi, rep: "because of", save: 0, why: '"due to" \xE8 formale e spesso impreciso. Preferisci "because of".', code: "VERB_009" },
  { re: /\ba large number of\b/gi, rep: "many", save: 3, why: '"a large number of" usa 4 parole dove basta "many".', code: "VERB_010" },
  { re: /\bthe fact that\b/gi, rep: "that", save: 2, why: '"the fact that" \xE8 ridondante. Spesso "that" da solo \xE8 sufficiente.', code: "VERB_011" },
  { re: /\bmake use of\b/gi, rep: "use", save: 2, why: '"make use of" usa 3 parole dove basta "use".', code: "VERB_012" },
  { re: /\btake into account\b/gi, rep: "consider", save: 2, why: '"take into account" usa 3 parole dove basta "consider".', code: "VERB_013" },
  { re: /\bprovide a summary of\b/gi, rep: "summarize", save: 3, why: '"provide a summary of" usa 4 parole dove basta "summarize".', code: "VERB_014a" },
  { re: /\bprovide a description of\b/gi, rep: "describe", save: 3, why: '"provide a description of" usa 4 parole dove basta "describe".', code: "VERB_014b" },
  { re: /\bprovide an explanation of\b/gi, rep: "explain", save: 3, why: '"provide an explanation of" usa 4 parole dove basta "explain".', code: "VERB_014c" },
  { re: /\bin terms of\b/gi, rep: "for", save: 2, why: '"in terms of" \xE8 spesso sostituibile con "for" o riformulando la frase.', code: "VERB_015" },
  // ── Italiano (serie VERB_1xx) ── le controparti italiane delle
  // costruzioni prolisse più comuni. Solo sostituzioni che funzionano in
  // qualunque contesto sintattico — esclusi casi come "in grado di", la
  // cui sostituzione corretta dipende dal soggetto ("è in grado di"→"può"
  // ma "sono in grado di"→"possono"), coperti dalle forme coniugate.
  { re: /\bal fine di\b/gi, rep: "per", save: 2, why: '"al fine di" \xE8 una costruzione verbosa. "per" trasmette lo stesso significato con meno token.', code: "VERB_101" },
  { re: /\ballo scopo di\b/gi, rep: "per", save: 2, why: '"allo scopo di" usa 3 parole dove basta "per".', code: "VERB_102" },
  { re: /\bdal momento che\b/gi, rep: "poich\xE9", save: 2, why: '"dal momento che" usa 3 parole dove basta "poich\xE9".', code: "VERB_103" },
  { re: /\bnel caso in cui\b/gi, rep: "se", save: 3, why: '"nel caso in cui" usa 4 parole dove basta "se".', code: "VERB_104" },
  { re: /\bper quanto riguarda\b/gi, rep: "riguardo a", save: 1, why: '"per quanto riguarda" \xE8 formale e prolisso. "riguardo a" (o riformulare) \xE8 pi\xF9 diretto.', code: "VERB_105" },
  { re: /\bin maniera tale da\b/gi, rep: "per", save: 3, why: '"in maniera tale da" usa 4 parole dove basta "per".', code: "VERB_106" },
  { re: /\bè in grado di\b/gi, rep: "pu\xF2", save: 3, why: '"\xE8 in grado di" usa 4 parole dove basta "pu\xF2".', code: "VERB_107" },
  { re: /\bsono in grado di\b/gi, rep: "possono", save: 3, why: '"sono in grado di" usa 4 parole dove basta "possono".', code: "VERB_108" },
  { re: /\bun gran numero di\b/gi, rep: "molti", save: 3, why: '"un gran numero di" usa 4 parole dove basta "molti".', code: "VERB_109" },
  { re: /\bfare uso di\b/gi, rep: "usare", save: 2, why: '"fare uso di" usa 3 parole dove basta "usare".', code: "VERB_110" },
  { re: /\bprendere in considerazione\b/gi, rep: "considerare", save: 2, why: '"prendere in considerazione" usa 3 parole dove basta "considerare".', code: "VERB_111" },
  { re: /\bfornisci un riassunto di\b/gi, rep: "riassumi", save: 3, why: '"fornisci un riassunto di" usa 4 parole dove basta "riassumi".', code: "VERB_112" },
  { re: /\bfornisci una descrizione di\b/gi, rep: "descrivi", save: 3, why: '"fornisci una descrizione di" usa 4 parole dove basta "descrivi".', code: "VERB_113" },
  { re: /\bfornisci una spiegazione di\b/gi, rep: "spiega", save: 3, why: '"fornisci una spiegazione di" usa 4 parole dove basta "spiega".', code: "VERB_114" }
];
function runVerbose(text) {
  const results = [];
  for (const { re, rep, save, why, code } of VERBOSE) {
    const pattern = new RegExp(re.source, re.flags);
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const replacement = typeof rep === "function" ? rep(m[0]) : rep;
      results.push(obs(
        "verbosity",
        "unnecessary",
        "\u{1F7E0} Frase prolissa",
        m[0],
        m.index,
        text,
        why,
        `Sostituisci con "${replacement}".`,
        { before: m[0], after: replacement },
        save,
        code
      ));
    }
  }
  return results;
}
var SYNONYMS = [
  { re: /\beach and every\b/gi, keep: "each", code: "SYN_001" },
  { re: /\bfirst and foremost\b/gi, keep: "first", code: "SYN_002" },
  { re: /\bend result\b/gi, keep: "result", code: "SYN_003" },
  { re: /\bpast history\b/gi, keep: "history", code: "SYN_004" },
  { re: /\bfuture plans\b/gi, keep: "plans", code: "SYN_005" },
  { re: /\badvance planning\b/gi, keep: "planning", code: "SYN_006" },
  { re: /\bfinal outcome\b/gi, keep: "outcome", code: "SYN_007" },
  { re: /\bclose proximity\b/gi, keep: "proximity", code: "SYN_008" },
  { re: /\bjoin together\b/gi, keep: "join", code: "SYN_009" },
  { re: /\bmerge together\b/gi, keep: "merge", code: "SYN_010" },
  { re: /\brepeat again\b/gi, keep: "repeat", code: "SYN_011" },
  { re: /\brevert back\b/gi, keep: "revert", code: "SYN_012" },
  { re: /\bask a question\b/gi, keep: "ask", code: "SYN_013" },
  { re: /\bcomplete and total\b/gi, keep: "complete", code: "SYN_014" },
  { re: /\btrue and accurate\b/gi, keep: "accurate", code: "SYN_015" },
  // ── Italiano (serie SYN_1xx) ── pleonasmi comuni, stessa logica.
  { re: /\bripeti di nuovo\b/gi, keep: "ripeti", code: "SYN_101" },
  { re: /\brisultato finale\b/gi, keep: "risultato", code: "SYN_102" },
  { re: /\bunisci insieme\b/gi, keep: "unisci", code: "SYN_103" },
  { re: /\bciascuno e ognuno\b/gi, keep: "ciascuno", code: "SYN_104" }
];
function runSynonymPairs(text) {
  const results = [];
  for (const { re, keep, code } of SYNONYMS) {
    const pattern = new RegExp(re.source, re.flags);
    let m;
    while ((m = pattern.exec(text)) !== null) {
      results.push(obs(
        "redundancy",
        "unnecessary",
        "\u{1F7E0} Ridondanza",
        m[0],
        m.index,
        text,
        `"${m[0]}" contiene due parole con lo stesso significato. I sinonimi consecutivi non aggiungono precisione ma aumentano i token.`,
        `Usa solo "${keep}".`,
        { before: m[0], after: keep },
        estimateTokens(m[0]) - estimateTokens(keep),
        code
      ));
    }
  }
  return results;
}
var POLITENESS = [
  { re: /\bplease\b/gi, code: "POL_001" },
  { re: /\bkindly\b/gi, code: "POL_002" },
  { re: /\bcould you please\b/gi, code: "POL_003" },
  { re: /\bwould you mind\b/gi, code: "POL_004" },
  { re: /\bi would like you to\b/gi, code: "POL_005" },
  { re: /\bi want you to\b/gi, code: "POL_006" },
  { re: /\bwould you be able to\b/gi, code: "POL_007" },
  // ── Italiano (serie POL_1xx) ── le formule di cortesia più comuni nei
  // prompt italiani. Ordinate dalla più lunga alla più corta dove si
  // sovrappongono ("potresti per favore" prima di "per favore"), così la
  // deduplicazione per range in runAllObservations tiene la segnalazione
  // più completa. "potresti" da solo NON è incluso: è anche un normale
  // condizionale dentro frasi di contenuto, segnalarlo ovunque
  // produrrebbe falsi positivi.
  { re: /\bpotresti per favore\b/gi, code: "POL_101" },
  { re: /\bper favore\b/gi, code: "POL_102" },
  { re: /\bper cortesia\b/gi, code: "POL_103" },
  { re: /\bgentilmente\b/gi, code: "POL_104" },
  { re: /\bvorrei che tu\b/gi, code: "POL_105" },
  { re: /\bti chiederei di\b/gi, code: "POL_106" },
  { re: /\bmi piacerebbe che\b/gi, code: "POL_107" }
];
function runPoliteness(text) {
  const results = [];
  for (const { re, code } of POLITENESS) {
    const pattern = new RegExp(re.source, re.flags);
    let m;
    while ((m = pattern.exec(text)) !== null) {
      results.push(obs(
        "politeness",
        "improvable",
        "\u{1F7E1} Cortesia inutile",
        m[0],
        m.index,
        text,
        `I modelli LLM rispondono alle istruzioni, non alla cortesia. "${m[0]}" spreca token senza migliorare la risposta.`,
        `Rimuovi "${m[0]}" e formula l'istruzione direttamente.`,
        { before: m[0], after: "(rimuovere)" },
        estimateTokens(m[0]),
        code
      ));
    }
  }
  return results;
}
function runNoTask(text, detectedLang) {
  let trimmed = text.trim();
  if (trimmed.length < 10) return [];
  const QUESTION = /^(qual[ei]?|come|cosa|che\s+cosa|che|chi|dove|quando|perch[ée]|quanto|quant[aie]|quali|what|how|why|who|where|when|which|whose|can|could|should|would|will|is|are|do|does|did)\b/i;
  if (QUESTION.test(trimmed) || /\?\s*$/.test(trimmed)) return [];
  trimmed = trimmed.replace(/^[^\p{L}\d]+/u, "");
  trimmed = trimmed.replace(
    /^(please|kindly|could you( please)?|would you( please)?|can you|per favore,?|per cortesia,?|gentilmente,?|potresti|potrebbe|vorrei che( tu)?|mi piacerebbe che|ti chiederei di)\s+/i,
    ""
  );
  if (/^\d+\s+\p{L}/u.test(trimmed)) return [];
  const ACTION = /^(write|create|generate|analyze|analyse|summarize|summarise|explain|describe|list|compare|translate|convert|extract|identify|find|check|review|improve|suggest|show|give|make|build|design|calculate|evaluate|classify|format|rewrite|update|add|remove|fix|debug|test|document|implement|define|outline|provide|help|answer|solve|draft|edit|assess|rank|sort|predict|recommend|plan|organize|organise|research|investigate|validate|compute|return|output|parse|transform|filter|select|search|fetch|load|run|execute|process|simulate|model|refactor|import|export|compile|install|configure|optimize|optimise|integrate|migrate|deploy|do|let|scrivi|scrivimi|crea|creami|genera|generami|analizza|analizzami|riassumi|riassumimi|spiega|spiegami|descrivi|descrivimi|elenca|elencami|confronta|traduci|traducimi|converti|convertimi|estrai|estraimi|identifica|trova|trovami|controlla|controllami|verifica|verificami|rivedi|migliora|migliorami|suggerisci|suggerisicimi|mostra|mostrami|dammi|dai|dacci|dagli|costruisci|costruiscimi|progetta|progettami|calcola|calcolami|valuta|valutami|classifica|classificami|formatta|formattami|riscrivi|riscrivimi|aggiorna|aggiornami|aggiungi|aggiungimi|rimuovi|rimuovimi|elimina|eliminami|correggi|correggimi|sistema|sistemami|implementa|implementami|definisci|definiscimi|delinea|fornisci|forniscimi|aiutami|rispondi|rispondimi|risolvi|risolvimi|pianifica|pianificami|organizza|organizzami|ricerca|indaga|convalida|calcola|restituisci|filtra|filtrami|seleziona|selezionami|cerca|cercami|carica|caricami|esegui|eseguimi|elabora|elaborami|simula|simulami|refactorizza|importa|esporta|compila|installa|configura|ottimizza|integra|migra|leggi|leggimi|apri|aprimi|chiudi|salva|salvami|scarica|scaricami|invia|inviami|riscrivi|estendi|estendimi|racconta|raccontami|proponi|proponimi|riformula|riformulami|sintetizza|sintetizzami|fai|fa|fammi|facci|fagli|sii|siate|abbi|abbiate|va|vai|di|dimmi|dimmelo|prepara|preparami|prepimi|elenca|riepiloga|riepilogami|approfondisci|chiarisci|chiariscimi|illustra|illustrami|indica|indicami|proponi)\b/i;
  if (ACTION.test(trimmed)) return [];
  if (/^(you are|sei\s+(un|uno|una))\b/i.test(trimmed)) return [];
  const ITALIAN_VERBS = ["scrivi", "crea", "genera", "analizza", "riassumi", "spiega", "descrivi", "elenca", "confronta", "traduci", "converti", "estrai", "identifica", "trova", "controlla", "verifica", "rivedi", "migliora", "suggerisci", "mostra", "dai", "costruisci", "progetta", "calcola", "valuta", "classifica", "formatta", "riscrivi", "aggiorna", "aggiungi", "rimuovi", "elimina", "correggi", "sistema", "implementa", "definisci", "fornisci", "aiuta", "rispondi", "risolvi", "pianifica", "organizza", "ricerca", "indaga", "convalida", "restituisci", "filtra", "seleziona", "cerca", "carica", "esegui", "elabora", "simula", "rendi"];
  const ENCLITICS = ["mi", "ti", "ci", "vi", "si", "lo", "la", "li", "le", "ne", "gli", "glielo", "gliela", "glieli", "gliele", "gliene"];
  const firstWord = trimmed.match(/^[a-zà-ù]+/i)?.[0]?.toLowerCase() ?? "";
  if (ITALIAN_VERBS.some((v) => ENCLITICS.some((e) => firstWord === v + e))) return [];
  const MIDTEXT_VERB = /(?:[.:\n]|^)\s*(scrivi|scrivimi|crea|creami|genera|generami|analizza|riassumi|spiega|spiegami|descrivi|elenca|elencami|confronta|traduci|converti|estrai|identifica|trova|trovami|controlla|verifica|rivedi|migliora|suggerisci|mostra|mostrami|dammi|dai|costruisci|progetta|calcola|valuta|classifica|formatta|riscrivi|aggiorna|aggiungi|rimuovi|elimina|correggi|sistema|implementa|definisci|fornisci|forniscimi|aiutami|rispondi|risolvi|pianifica|organizza|ricerca|restituisci|filtra|seleziona|cerca|carica|esegui|elabora|simula|racconta|raccontami|proponi|riformula|sintetizza|prepara|preparami|realizza|realizzami|write|create|generate|analyze|summarize|explain|describe|list|compare|translate|convert|extract|identify|find|check|review|improve|suggest|show|give|make|build|design|calculate|evaluate|classify|rewrite|update|draft|provide|help|answer|solve)\b/i;
  if (MIDTEXT_VERB.test(trimmed)) return [];
  return [obs(
    "no_task",
    "contradiction",
    "\u{1F534} Nessun task",
    trimmed.slice(0, 40),
    0,
    text,
    "Il prompt non inizia con un verbo d'azione chiaro. Senza un'istruzione esplicita il modello sceglie autonomamente cosa fare, con risultati imprevedibili.",
    detectedLang === "it" ? "Inizia con un verbo imperativo: Scrivi, Analizza, Riassumi, Spiega, Elenca, Confronta, Genera\u2026" : "Inizia con un verbo imperativo: Write, Analyze, Summarize, Explain, List, Compare, Generate\u2026",
    { before: trimmed.slice(0, 30), after: detectedLang === "it" ? "Analizza / Scrivi / Spiega \u2026" : "Analyze / Write / Explain \u2026" },
    0,
    "PL_001"
  )].map((o) => ({ ...o, matchText: "(no task \u2014 " + o.matchText + ")" }));
}
function isQuestion(text) {
  const t = text.trim();
  return /\?\s*$/.test(t) || /^(qual[ei]?|come|cosa|che|chi|dove|quando|perch[ée]|quant[oaie]|quali|what|how|why|who|where|when|which|whose|can|could|should|is|are|do|does)\b/i.test(t);
}
function isSelfBounding(text) {
  const t = text.trim().replace(/^[^\p{L}\d]+/u, "");
  return /^(translate|traduci|traducimi|list|elenca|elencami|enumera|calculate|calcola|calcolami|classify|classifica|classificami|convert|converti|count|conta|sort|ordina|rank|classifica)\b/i.test(t);
}
function wordCount(text) {
  return (text.trim().match(/\S+/g) ?? []).length;
}
function runNoFormat(text) {
  if (text.length < 80) return [];
  if (isQuestion(text) || isSelfBounding(text)) return [];
  const FORMAT = /\b(json|markdown|html|xml|yaml|csv|diff|code|codice|snippet|list|bullet|table|numbered|paragraph|sentence|format|structure|outline|heading|section|column|schema|diagram|plain text|elenco|lista|puntat[oa]|tabell[ae]|numerat[oa]|paragraf[oi]|fras[ei]|formato|struttura|intestazione|sezion[ei]|colonn[ae]|punt[oi]|diagramma|testo semplice)\b/i;
  if (FORMAT.test(text)) return [];
  const IMPLIED = /\b(\d+\s*(mod[io]|step|pas[so]i?|punt[oi]|esem[pì]|consigl[io]|idea[e]?|argument[io]?|reason[s]?|tip[s]?|headline|titol[io]|fras[ei]|domand[ae]|opzion[ei]|alternativ[ae]|variant[ei]|slogan|hashtag|bullet)|passo per passo|step by step|scrivi un'?email|scrivi una lettera|scrivi un report|scrivi un articolo|write an? (email|letter|report|article|blog)|riassumi|summarize|summarise|riscrivi|rewrite|confronta|compare|pro[s]? e contro|pros and cons|vantaggi e svantaggi|script|funzion[ei]|class[ei]|component[ei])\b/i;
  if (IMPLIED.test(text)) return [];
  return [obs(
    "no_format",
    "improvable",
    "\u{1F7E1} Nessun formato",
    "(intero prompt)",
    0,
    text,
    "Senza un formato di output specificato il modello sceglie la struttura autonomamente.",
    'Specifica il formato: "in JSON", "come lista numerata", "in 2 paragrafi", "in una tabella Markdown".',
    { before: "\u2026", after: "\u2026 in formato JSON." },
    0,
    "PL_002"
  )];
}
function runNoRole(text) {
  if (wordCount(text) < 25) return [];
  if (isQuestion(text) || isSelfBounding(text)) return [];
  const ROLE = /\b(you are|act as|as an? |your role|pretend|imagine you|sei un|sei uno|sei una|agisci come|nel ruolo di|come esperto|in qualità di)\b/i;
  if (ROLE.test(text)) return [];
  const GENERATIVE = /\b(write|create|generate|analyze|analyse|describe|design|draft|compose|explain|review|assess|scrivi|crea|genera|analizza|descrivi|progetta|componi|redigi|spiega|rivedi|valuta|racconta)\b/i;
  if (!GENERATIVE.test(text)) return [];
  return [obs(
    "no_role",
    "improvable",
    "\u{1F7E1} Nessun ruolo",
    text.slice(0, 20),
    0,
    text,
    'Assegnare un ruolo o persona al modello ("Sei un ingegnere senior") pu\xF2 migliorare qualit\xE0 e pertinenza orientando vocabolario, tono e profondit\xE0. Facoltativo, ma utile nei task aperti.',
    `Aggiungi un ruolo all'inizio: "Sei un [esperto di\u2026]. ".`,
    { before: text.slice(0, 20), after: "Sei un esperto di [dominio]. " + text.slice(0, 20) },
    0,
    "PL_006"
  )];
}
function runNoLength(text) {
  if (wordCount(text) < 25) return [];
  if (isSelfBounding(text) || isQuestion(text)) return [];
  if (/\b\d{1,2}\s+\p{L}/u.test(text)) return [];
  const LENGTH = /\b(\d+\s*(word|sentence|paragraph|bullet|line|character|token)s?|brief|concise|under \d+|at most|no more than|maximum|in \d+|\d+\s*(parola|parole|frase|frasi|paragrafo|paragrafi|riga|righe|carattere|caratteri|punto|punti)|breve|brevemente|conciso|concisa|sintetic[oa]|al massimo|massimo|non più di)\b/i;
  if (LENGTH.test(text)) return [];
  return [obs(
    "no_length",
    "improvable",
    "\u{1F7E1} Nessun limite di lunghezza",
    "(intero prompt)",
    0,
    text,
    "Senza un limite di lunghezza il modello genera risposte di dimensione arbitraria, aumentando i token di output e i costi.",
    'Aggiungi: "in 100 parole", "in 3 bullet point", "in 2 frasi".',
    { before: "\u2026", after: "\u2026 in 3 bullet point." },
    0,
    "PL_009"
  )];
}
var VAGUE_TERMS = [
  { re: /\buna?\s+rob[ae]\b/gi, term: "una roba" },
  { re: /\bqualcosa\s+(di|come|tipo|sul|sulla|riguardo|per|che)\b/gi, term: "qualcosa di\u2026" },
  { re: /\bcon\s+(una\s+cosa|qualcosa|delle\s+cose)\b/gi, term: "con una cosa/qualcosa" },
  { re: /\buna?\s+cosa\s+(tipo|così|del genere|carina|simile|bella|interessante|figa)\b/gi, term: "una cosa tipo\u2026" },
  { re: /\baiutami\s+con\s+(una|questa|delle)\b/gi, term: "aiutami con una\u2026" },
  { re: /\bcose\s+(del genere|così|simili|varie|del tipo)\b/gi, term: "cose del genere" },
  { re: /\btipo\s+(un|una|che|quella|questo)\b/gi, term: "tipo\u2026" },
  { re: /\bquella\s+cosa\b/gi, term: "quella cosa" },
  { re: /\bun\s+coso\b/gi, term: "un coso" },
  { re: /\bpiù\s+o\s+meno\b/gi, term: "pi\xF9 o meno" },
  { re: /\bil tema che preferisci|argomento a piacere|quello che vuoi|come preferisci|come ti pare\b/gi, term: "a scelta libera" },
  { re: /\b(some\s+(kind\s+of|sort\s+of)|something\s+like|a\s+thing\s+that|some\s+stuff|whatever you want)\b/gi, term: "something like\u2026" }
];
function runVaguePlaceholders(text) {
  if (isQuestion(text)) return [];
  const results = [];
  for (const { re, term } of VAGUE_TERMS) {
    const pattern = new RegExp(re.source, re.flags);
    let m;
    while ((m = pattern.exec(text)) !== null) {
      results.push(obs(
        "ambiguity",
        "improvable",
        "\u{1F7E1} Termine vago",
        m[0],
        m.index,
        text,
        `"${m[0]}" \xE8 un segnaposto generico: il modello deve indovinare cosa intendi. I prompt vaghi producono risposte imprevedibili.`,
        "Sostituisci con ci\xF2 che vuoi davvero: oggetto concreto, formato, contesto.",
        { before: m[0], after: "[descrizione concreta]" },
        0,
        "VAGUE_001"
      ));
    }
  }
  return results;
}
function runScopeLengthContradiction(text) {
  const COMPLETE = /\b(completo|completa|esaustiv[oa]|esaurient[ei]|dettagliat[oa]|approfondit[oa]|dettagliatamente|molto lungo|estremamente|approfondisci|nei minimi dettagli|comprehensive|exhaustive|detailed|thorough|in-depth|in depth|extensive|elaborate)\b/i;
  const SHORT = /\b(in una frase|in 1 frase|in una riga|in 1 riga|una sola parola|in una parola|1 parola|massimo\s+([1-9]|[12]\d|30)\s+parole|max\s+([1-9]|[12]\d|30)\s+parole|in ([1-9]|1\d|20)\s+parole|molto breve|breve|brevemente|concis[oa]|in poche parole|una sola frase|in sintesi|one sentence|in \d\d? words|very short|briefly|in a word|single word)\b/i;
  const cm = text.match(COMPLETE);
  const sm = text.match(SHORT);
  if (!cm || !sm) return [];
  return [obs(
    "contradiction",
    "contradiction",
    "\u{1F534} Contraddizione",
    cm[0] + " \u2026 " + sm[0],
    text.indexOf(cm[0]),
    text,
    `"${cm[0]}" e "${sm[0]}" si contraddicono: chiedi qualcosa di esaustivo e allo stesso tempo molto breve. Il modello non pu\xF2 soddisfare entrambi e ne ignorer\xE0 uno.`,
    "Scegli una delle due: o completo, o breve. Oppure specifica la lunghezza adeguata alla profondit\xE0 richiesta.",
    { before: cm[0] + " \u2026 " + sm[0], after: "(coerenza tra profondit\xE0 e lunghezza)" },
    0,
    "CONTRA_001"
  )];
}
var CONFLICT_PAIRS = [
  {
    a: /\b(formale|professionale|serio|istituzionale|formal|professional)\b/i,
    b: /\b(emoji|emoticon|informale|colloquiale|scherzoso|divertente|casual|slang|amichevole)\b/i,
    why: "registro formale e tono informale/emoji"
  },
  {
    a: /\b(tecnico|dettaglio tecnico|per esperti|avanzato|technical|for experts)\b/i,
    b: /\b(per (un )?bambin[oi]|per principianti|semplicissim[oa]|come se avessi \d+ anni|for (a )?child|for beginners|like i'?m \d+)\b/i,
    why: "livello tecnico/esperto e pubblico principiante/bambino"
  },
  {
    a: /\b(in inglese|in english|traduci in inglese)\b/i,
    b: /\b(in italiano|in francese|in spagnolo|in tedesco|in italian)\b/i,
    why: "due lingue di output diverse"
  },
  {
    a: /\b(creativ[oa]|fantasios[oa]|originale|libero|creative|imaginative)\b/i,
    b: /\b(attieniti (strettamente|esattamente)|segui alla lettera|senza (deviare|inventare)|rigorosamente|strictly follow|do not deviate)\b/i,
    why: "libert\xE0 creativa e aderenza rigida"
  },
  {
    a: /\b(elenco|lista|bullet|punti|list)\b/i,
    b: /\b(in prosa|paragrafo discorsivo|testo scorrevole|in a single paragraph|prose)\b/i,
    why: "formato a elenco e prosa continua"
  },
  {
    a: /\b(solo (i )?fatti|oggettiv[oa]|senza opinioni|neutrale|just the facts|objective)\b/i,
    b: /\b(dai (la )?tua opinione|cosa ne pensi|opinione personale|your opinion|what do you think)\b/i,
    why: "solo fatti e opinione personale"
  }
];
function runConflictingInstructions(text) {
  const results = [];
  for (const pair of CONFLICT_PAIRS) {
    const ma = text.match(pair.a);
    const mb = text.match(pair.b);
    if (ma && mb) {
      results.push(obs(
        "contradiction",
        "contradiction",
        "\u{1F534} Istruzioni in conflitto",
        `${ma[0]} \u2026 ${mb[0]}`,
        Math.min(text.indexOf(ma[0]), text.indexOf(mb[0])),
        text,
        `Il prompt chiede due cose incompatibili (${pair.why}): "${ma[0]}" e "${mb[0]}". Il modello non pu\xF2 soddisfarle entrambe e ne sceglier\xE0 una a caso.`,
        "Tieni una sola delle due istruzioni in conflitto, oppure chiarisci come combinarle.",
        { before: `${ma[0]} \u2026 ${mb[0]}`, after: "(scegli una direzione coerente)" },
        0,
        "CONTRA_002"
      ));
    }
  }
  return results;
}
function runPassiveVoice(text, detectedLang) {
  if (detectedLang !== "en") return [];
  const results = [];
  const re = /\b(is|are|was|were|be|been|being)\s+(\w+ed)\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push(obs(
      "passive_voice",
      "improvable",
      "\u{1F7E1} Voce passiva",
      m[0],
      m.index,
      text,
      "Le costruzioni passive sono pi\xF9 ambigue per i modelli LLM. La voce attiva \xE8 pi\xF9 diretta e usa meno token per lo stesso significato.",
      "Riformula in voce attiva.",
      { before: m[0], after: "(soggetto + verbo attivo)" },
      1,
      "GRAM_010"
    ));
  }
  return results;
}
function runAmbiguousPronoun(text) {
  const trimmed = text.trim();
  const re = /^(fix|update|change|improve|modify|rewrite|edit|correct|adjust|refactor|optimize|optimise|clean up|simplify|review|check|correggi|aggiorna|cambia|migliora|modifica|riscrivi|sistema|rivedi|controlla|riordina|semplifica)\s+(it|this|that|these|those|lo|la|li|le|questo|questa|questi|queste|quello|quella)\b/i;
  const m = trimmed.match(re);
  if (!m) return [];
  return [obs(
    "ambiguity",
    "contradiction",
    "\u{1F534} Riferimento ambiguo",
    m[0],
    0,
    text,
    `"${m[2]}" non ha un referente: \xE8 la prima frase del prompt, quindi non c'\xE8 nulla a cui possa riferirsi. Il modello deve indovinare il contesto.`,
    `Sostituisci "${m[2]}" con l'oggetto specifico (es. "questo paragrafo", "la funzione login", "il file config.json").`,
    { before: m[0], after: `${m[1]} [oggetto specifico]` },
    0,
    "AMB_001"
  )];
}
function runVagueQuality(text) {
  const results = [];
  const re = /\b(better|nicer|cleaner|prettier|cooler|smarter|simpler|improved?|migliore|migliori|più bell[oa]|più pulit[oa]|più carin[oa]|più intelligente|più semplice|migliorat[oa])\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push(obs(
      "ambiguity",
      "improvable",
      "\u{1F7E1} Criterio vago",
      m[0],
      m.index,
      text,
      `"${m[0]}" non definisce un criterio misurabile. Il modello non sa quale aspetto migliorare n\xE9 come valutare il risultato.`,
      "Specifica il criterio: pi\xF9 veloce, pi\xF9 leggibile, pi\xF9 conciso, con meno dipendenze\u2026",
      { before: m[0], after: '[criterio specifico, es. "pi\xF9 leggibile"]' },
      0,
      "AMB_002"
    ));
  }
  return results;
}
var WEAK_VERBS = [
  "handle",
  "deal with",
  "work on",
  "look at",
  "address",
  "take care of",
  "do something about",
  "figure out",
  "sort out",
  "gestisci",
  "occupati di",
  "dai un'occhiata a",
  "affronta",
  "prenditi cura di",
  "sistema in qualche modo"
];
function runWeakVerbs(text) {
  const results = [];
  for (const verb of WEAK_VERBS) {
    const re = new RegExp(`\\b${verb.replace(/ /g, "\\s+")}\\b`, "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      results.push(obs(
        "weak_verb",
        "improvable",
        "\u{1F7E1} Verbo debole",
        m[0],
        m.index,
        text,
        `"${m[0]}" \xE8 un verbo vago: non specifica un'azione concreta. Il modello deve indovinare cosa fare esattamente.`,
        "Sostituisci con un verbo specifico: fix, implement, refactor, investigate, resolve, document\u2026",
        { before: m[0], after: "[verbo specifico]" },
        0,
        "WEAK_001"
      ));
    }
  }
  return results;
}
var _lastDetectedLang = "en";
function makeLangState() {
  return { lastLang: "en" };
}
function runAllObservations(text, disabledRules = [], spell, inputPricePerMillion = 2.5, langState) {
  if (!text?.trim()) return [];
  _inputPricePerMillion = inputPricePerMillion;
  const previous = langState ? langState.lastLang : _lastDetectedLang;
  const detected = detectLanguage(text, previous, 0.7);
  if (langState) langState.lastLang = detected;
  else _lastDetectedLang = detected;
  if (spell?.setLanguage) {
    spell.setLanguage(detected);
  }
  const disabled = new Set(disabledRules);
  const all = [];
  const runners = [
    () => runSpell(text, spell, detected),
    () => runRepeatedWord(text),
    () => runDoubleNegation(text, detected),
    () => runLongSentence(text),
    () => runMultipleSpaces(text),
    () => runFillers(text),
    () => runVerbose(text),
    () => runSynonymPairs(text),
    () => runPoliteness(text),
    () => runNoTask(text, detected),
    () => runNoFormat(text),
    () => runNoRole(text),
    () => runNoLength(text),
    () => runPassiveVoice(text, detected),
    () => runVaguePlaceholders(text),
    () => runScopeLengthContradiction(text),
    () => runConflictingInstructions(text),
    () => runAmbiguousPronoun(text),
    () => runVagueQuality(text),
    () => runWeakVerbs(text)
  ];
  for (const runner of runners) {
    const obs2 = runner().filter((o) => !disabled.has(o.code));
    all.push(...obs2);
  }
  const deduped = [];
  const usedRanges = [];
  all.sort((a, b) => b.impact.tokensSaved - a.impact.tokensSaved || a.offset - b.offset);
  for (const o of all) {
    const isWholePrompt = o.matchText.startsWith("(");
    if (isWholePrompt) {
      deduped.push(o);
      continue;
    }
    const overlaps = usedRanges.some(
      ([s, e]) => o.offset < e && o.offset + o.length > s
    );
    if (!overlaps) {
      deduped.push(o);
      usedRanges.push([o.offset, o.offset + o.length]);
    }
  }
  return deduped.sort((a, b) => a.offset - b.offset);
}
function resetLanguageState() {
  _lastDetectedLang = "en";
}

// src/compression/index.ts
var REMOVE_MARKER = "(rimuovere)";
function compressText(text, observations) {
  const applicable = observations.filter((o) => {
    if (o.matchText.startsWith("(")) return false;
    if (o.type === "spelling") return false;
    const after = o.example?.after;
    if (after == null) return false;
    return after === REMOVE_MARKER || !after.startsWith("(");
  }).sort((a, b) => b.offset - a.offset);
  let compressed = text;
  const claimedRanges = [];
  for (const o of applicable) {
    const overlapsExisting = claimedRanges.some(([s, e]) => o.offset < e && o.offset + o.length > s);
    if (overlapsExisting) continue;
    const replacement = o.example.after === REMOVE_MARKER ? "" : o.example.after;
    compressed = compressed.slice(0, o.offset) + replacement + compressed.slice(o.offset + o.length);
    claimedRanges.push([o.offset, o.offset + o.length]);
  }
  return compressed.replace(/ {2,}/g, " ").replace(/ +([.,!?;:])/g, "$1").trim();
}

// src/scoring/index.ts
function label(score) {
  if (score >= 82) return "excellent";
  if (score >= 62) return "good";
  if (score >= 42) return "fair";
  return "poor";
}
function clamp(n) {
  return Math.max(0, Math.min(100, n));
}
function dim(name, score, why, tips) {
  const s = clamp(Math.round(score));
  return { name, score: s, label: label(s), why, tips };
}
function isSelfBoundingTask(text) {
  const t = text.trim().replace(/^[^\p{L}\d]+/u, "");
  return /^(translate|traduci|traducimi|list|elenca|elencami|enumera|calculate|calcola|calcolami|classify|classifica|classificami|convert|converti|count|conta|sort|ordina|rank)\b/i.test(t);
}
function scorePrompt(text, observations, tokens) {
  const byCode = (code) => observations.filter((o) => o.code === code).length;
  const byType = (type) => observations.filter((o) => o.type === type).length;
  const words = (text.trim().match(/\S+/g) ?? []).length;
  const clarityPenalty = (byCode("PL_001") > 0 ? 35 : 0) + byType("spelling") * 7 + byType("double_negation") * 15 + byType("contradiction") * 28 + Math.min(36, byType("ambiguity") * 14) + byType("weak_verb") * 4;
  const clarityScore = dim(
    "Clarity",
    100 - clarityPenalty,
    clarityPenalty === 0 ? "Task chiaro, nessuna ambiguit\xE0 o conflitto." : "Il prompt manca di chiarezza o si contraddice.",
    [
      ...byCode("PL_001") > 0 ? ["Aggiungi un verbo d'azione chiaro."] : [],
      ...byType("contradiction") > 0 ? ["Risolvi le istruzioni in conflitto."] : [],
      ...byType("ambiguity") > 0 ? ["Sostituisci i termini vaghi con richieste concrete."] : [],
      ...byType("spelling") > 0 ? [`Correggi ${byType("spelling")} errore/i ortografico/i.`] : [],
      ...byType("double_negation") > 0 ? ["Rimuovi le doppie negazioni."] : []
    ]
  );
  const has = (re) => re.test(text);
  const hasRole = has(/\b(you are|act as|as an? |your role|sei un|sei uno|sei una|agisci come|nel ruolo di|come esperto|in qualità di|impersona|vesti i panni)\b/i);
  const hasFormat = has(/\b(json|markdown|html|xml|yaml|csv|diff|in formato|come (una )?lista|elenco puntato|numerat[oa]|tabell[ae]|in \d+ paragraf|bullet|schema|in una tabella|formato)\b/i);
  const hasLength = has(/\b(\d+\s*(word|parole|parola|frasi|frase|paragraf|righe|riga|bullet|punti|caratteri)|brevemente|concis[oa]|sintetic[oa]|in \d+ parole|max\w*\s*\d+|al massimo \d+|no more than|at most)\b/i);
  const hasExamples = has(/\b(esempi?o?:|per esempio|ad esempio|e\.g\.|example:|for example|→|input:.*output:)\b/i) || /\n\s*[-*]\s.+→/.test(text);
  const hasConstraints = has(/\b(deve|devono|assicurati|non (usare|includere|superare)|evita|solo se|vincol|requisit|tono:?|stile:?|in modo|purché|a condizione|must|should|do not|don't|avoid|constraints?:|tone:?|target|pubblico|audience|tono (giovane|formale|serio|amichevole|professionale|informale|ironico|neutro)|per (un pubblico|giovani|adulti|professionisti|principianti))\b/i);
  const hasDelimiters = /```|~~~|\n#{1,3}\s|\n\s*[-*]\s|\n\d+[.)]\s|<\w+>|"""/.test(text) || (text.match(/\n/g)?.length ?? 0) >= 2;
  const hasContext = has(/\b(contesto:|context:|background:|dato che|considerato che|sto (lavorando|creando|scrivendo|lanciando)|il mio|la mia|our|my (team|company|project|app))\b/i);
  const hasTaskVerb = byCode("PL_001") === 0;
  let specPoints = 0;
  if (hasTaskVerb) specPoints += 14;
  if (hasRole) specPoints += 13;
  if (hasFormat) specPoints += 16;
  if (hasLength) specPoints += 11;
  if (hasExamples) specPoints += 20;
  if (hasConstraints) specPoints += 14;
  if (hasContext) specPoints += 12;
  if (hasDelimiters) specPoints += 8;
  specPoints -= byType("weak_verb") * 6;
  specPoints = Math.max(0, specPoints);
  let precisionRaw = 22 + (100 - 22) * (1 - Math.exp(-specPoints / 42));
  if (isSelfBoundingTask(text)) precisionRaw = Math.max(precisionRaw, 78);
  const precisionScore = dim(
    "Precision",
    precisionRaw,
    precisionRaw >= 75 ? "Ben specificato: ruolo, formato, vincoli o esempi presenti." : precisionRaw >= 52 ? "Discretamente specificato \u2014 un formato o un esempio aiuterebbero." : "Poco specificato: il modello deve indovinare troppo.",
    [
      ...!hasTaskVerb ? ["Inizia con un verbo che dica cosa fare."] : [],
      ...!hasFormat && !isSelfBoundingTask(text) ? ["Specifica il formato di output."] : [],
      ...!hasExamples ? ["Aggiungi un esempio del risultato voluto."] : [],
      ...!hasConstraints ? ["Indica vincoli, tono o pubblico."] : [],
      ...!hasContext ? ["Aggiungi il contesto: a cosa serve, per chi."] : []
    ]
  );
  const tok = tokens.tokenCount;
  let lengthBase = 100;
  const lengthTips = [];
  if (tok < 8) {
    lengthBase = 40;
    lengthTips.push("Prompt molto corto: aggiungi contesto, formato, vincoli.");
  } else if (tok < 16) {
    lengthBase = 66;
    lengthTips.push("Corto: uno o due dettagli in pi\xF9 aiuterebbero.");
  } else if (tok > 450) {
    lengthBase = 62;
    lengthTips.push("Molto lungo: controlla le ridondanze.");
  } else if (tok > 280) {
    lengthBase = 82;
  }
  if (tokens.avgTokensPerSentence > 35) {
    lengthBase -= 10;
    lengthTips.push("Frasi troppo lunghe in media.");
  }
  const lengthScore = dim(
    "Length",
    lengthBase,
    lengthBase >= 82 ? `Lunghezza adeguata (${tok} token).` : `${tok} token \u2014 ${tok < 16 ? "un po' corto" : "valuta di ridurre"}.`,
    lengthTips
  );
  const redundancyCount = byType("redundancy") + byType("filler") + byType("verbosity") + byType("politeness") + byType("repetition");
  const redundancyScore = dim(
    "Redundancy",
    100 - Math.min(60, redundancyCount * 8),
    redundancyCount === 0 ? "Nessuna ridondanza." : `${redundancyCount} elemento/i ridondante/i.`,
    redundancyCount > 0 ? [`Rimuovi ${redundancyCount} parola/e o frase/i superflua/e.`] : []
  );
  const passiveCount = byType("passive_voice");
  const longSentences = byType("long_sentence");
  const readabilityScore = dim(
    "Readability",
    100 - (passiveCount * 8 + longSentences * 12),
    passiveCount + longSentences === 0 ? "Buona leggibilit\xE0." : "Alcune frasi riducono la leggibilit\xE0.",
    [
      ...passiveCount > 0 ? [`${passiveCount} costrutto/i passivo/i: usa la voce attiva.`] : [],
      ...longSentences > 0 ? [`${longSentences} frase/i lunga/e: dividile.`] : []
    ]
  );
  let total = Math.round(
    clarityScore.score * 0.3 + precisionScore.score * 0.3 + lengthScore.score * 0.13 + redundancyScore.score * 0.14 + readabilityScore.score * 0.13
  );
  const contradictions = byType("contradiction");
  if (contradictions > 0) total = Math.min(total, 58 - Math.min(12, (contradictions - 1) * 6));
  if (byCode("PL_001") > 0) total = Math.min(total, 60);
  const vague = byType("ambiguity");
  if (vague >= 2) total = Math.min(total, 56);
  else if (vague === 1) total = Math.min(total, 68);
  const wellSpecifiedShort = hasTaskVerb && (hasFormat || hasLength || hasRole || hasExamples || isSelfBoundingTask(text));
  if (words < 4) total = Math.min(total, 38);
  else if (words < 8 && !wellSpecifiedShort) total = Math.min(total, 66);
  total = clamp(total);
  const lbl = label(total);
  const worst = [clarityScore, precisionScore, lengthScore, redundancyScore, readabilityScore].sort((a, b) => a.score - b.score)[0];
  const summaries = {
    excellent: "Ottimo prompt: ben strutturato e specificato.",
    good: `Buon prompt, migliorabile. Focus: ${worst.name.toLowerCase()}.`,
    fair: `Prompt discreto. Problema principale: ${worst.name.toLowerCase()}.`,
    poor: `Prompt debole. Inizia da: ${worst.name.toLowerCase()}.`
  };
  return {
    total,
    label: lbl,
    dimensions: {
      clarity: clarityScore,
      precision: precisionScore,
      length: lengthScore,
      redundancy: redundancyScore,
      readability: readabilityScore
    },
    summary: summaries[lbl]
  };
}

// src/autocorrect/index.ts
var TYPO_MAP_EN = {
  "teh": "the",
  "adn": "and",
  "taht": "that",
  "waht": "what",
  "thier": "their",
  "recieve": "receive",
  "beleive": "believe",
  "definately": "definitely",
  "occured": "occurred",
  "seperate": "separate",
  "begining": "beginning",
  "accomodate": "accommodate",
  "untill": "until",
  "occurance": "occurrence",
  "comming": "coming",
  "writting": "writing",
  "runing": "running",
  "makeing": "making",
  "haveing": "having",
  "takeing": "taking",
  "useing": "using",
  "giveing": "giving",
  "dont": "don't",
  "wont": "won't",
  "cant": "can't",
  "isnt": "isn't",
  "wasnt": "wasn't",
  "havent": "haven't",
  "wouldnt": "wouldn't",
  "couldnt": "couldn't",
  "shouldnt": "shouldn't",
  "arent": "aren't",
  "doesnt": "doesn't",
  "didnt": "didn't"
};
var TYPO_MAP_IT = {
  "perch\xE8": "perch\xE9",
  "poich\xE8": "poich\xE9",
  "finch\xE8": "finch\xE9",
  "affinch\xE8": "affinch\xE9",
  "bench\xE8": "bench\xE9",
  "sicch\xE8": "sicch\xE9",
  "giacch\xE8": "giacch\xE9",
  "nonch\xE8": "nonch\xE9",
  "sopratutto": "soprattutto",
  "propio": "proprio",
  "aposta": "apposta",
  "daccordo": "d'accordo",
  "avvolte": "a volte",
  "qual'\xE8": "qual \xE8",
  "qual'era": "qual era",
  "p\xF2": "po'",
  "st\xF2": "sto",
  "st\xE0": "sta",
  "f\xE0": "fa",
  "s\xF9": "su",
  // Missing final accents. A near-complete frequency dictionary (built from
  // real subtitles) accepts these accent-less forms as "correct" because
  // people type them that way constantly — so the spell checker alone won't
  // flag them. Handled here instead, but ONLY for forms whose accent-less
  // spelling is never itself a valid Italian word. Deliberately EXCLUDES
  // ambiguous ones: "pero" (pear tree), "papa" (pope), "meta" (goal),
  // "e/è", "si/sì", "la/là", "da/dà", "ne/né", "se/sé", "te/tè", "sara"
  // (name) — auto-fixing those would corrupt correct text.
  "citta": "citt\xE0",
  "universita": "universit\xE0",
  "liberta": "libert\xE0",
  "verita": "verit\xE0",
  "qualita": "qualit\xE0",
  "quantita": "quantit\xE0",
  "facolta": "facolt\xE0",
  "attivita": "attivit\xE0",
  "realta": "realt\xE0",
  "societa": "societ\xE0",
  "possibilita": "possibilit\xE0",
  "novita": "novit\xE0",
  "piu": "pi\xF9",
  "puo": "pu\xF2",
  "gia": "gi\xE0",
  "cioe": "cio\xE8",
  "cosi": "cos\xEC",
  "virtu": "virt\xF9",
  "gioventu": "giovent\xF9",
  "tribu": "trib\xF9",
  "servitu": "servit\xF9",
  "lunedi": "luned\xEC",
  "martedi": "marted\xEC",
  "mercoledi": "mercoled\xEC",
  "giovedi": "gioved\xEC",
  "venerdi": "venerd\xEC"
};
function compileTypos(map) {
  return Object.entries(map).map(([typo, correction]) => ({
    re: wholeWord(typo),
    correction
  }));
}
var TYPOS_BY_LANG = {
  en: compileTypos(TYPO_MAP_EN),
  it: compileTypos(TYPO_MAP_IT)
};
var COMPRESSION_COMPLETIONS = [
  { trigger: /\bin order to\b/i, full: "in order to", compressed: "to" },
  { trigger: /\bdue to the fact that\b/i, full: "due to the fact that", compressed: "because" },
  { trigger: /\bhas the ability to\b/i, full: "has the ability to", compressed: "can" },
  { trigger: /\bis able to\b/i, full: "is able to", compressed: "can" },
  { trigger: /\bfor the purpose of\b/i, full: "for the purpose of", compressed: "to" },
  { trigger: /\bwith regard to\b/i, full: "with regard to", compressed: "about" },
  { trigger: /\ba large number of\b/i, full: "a large number of", compressed: "many" },
  { trigger: /\bthe fact that\b/i, full: "the fact that", compressed: "that" },
  { trigger: /\bmake use of\b/i, full: "make use of", compressed: "use" },
  { trigger: /\btake into account\b/i, full: "take into account", compressed: "consider" },
  { trigger: /\bat this point in time\b/i, full: "at this point in time", compressed: "now" },
  { trigger: /\bin the event that\b/i, full: "in the event that", compressed: "if" },
  { trigger: /\beach and every\b/i, full: "each and every", compressed: "each" },
  { trigger: /\bfirst and foremost\b/i, full: "first and foremost", compressed: "first" },
  { trigger: /\bjoin together\b/i, full: "join together", compressed: "join" },
  { trigger: /\brepeat again\b/i, full: "repeat again", compressed: "repeat" },
  { trigger: /\brevert back\b/i, full: "revert back", compressed: "revert" },
  { trigger: /\bend result\b/i, full: "end result", compressed: "result" },
  { trigger: /\bpast history\b/i, full: "past history", compressed: "history" }
];
function preserveCase(original, correction) {
  if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return correction[0].toUpperCase() + correction.slice(1);
  }
  return correction;
}
function getWordAtCursor(text, cursorOffset) {
  let start = cursorOffset - 1;
  while (start >= 0 && isWordChar(text[start])) start--;
  start++;
  let end = cursorOffset;
  while (end < text.length && isWordChar(text[end])) end++;
  const word = text.slice(start, end);
  if (!word || word.length < 2) return null;
  return { word, start, end };
}
function getAutocorrectSuggestions(text, spell, lang = "en") {
  if (!text?.trim()) return [];
  spell?.setLanguage?.(lang);
  const suggestions = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { re, correction } of TYPOS_BY_LANG[lang]) {
    re.lastIndex = 0;
    let m2;
    while ((m2 = re.exec(text)) !== null) {
      if (!seen.has(m2.index)) {
        seen.add(m2.index);
        suggestions.push({
          original: m2[0],
          corrected: preserveCase(m2[0], correction),
          offset: m2.index,
          length: m2[0].length,
          confidence: 0.98,
          type: "spelling",
          autoApply: true
        });
      }
    }
  }
  const wordRe = wordRegex();
  let m;
  while ((m = wordRe.exec(text)) !== null) {
    const word = m[0];
    if (word.length < 4) continue;
    if (seen.has(m.index)) continue;
    if (/^[A-Z]{2,}$/.test(word)) continue;
    if (/[a-z][A-Z]/.test(word)) continue;
    const isWordCorrect = spell ? spell.correct(word) : isCorrect(word, lang);
    if (isWordCorrect) continue;
    const suggs = spell ? spell.suggest(word.toLowerCase(), 3) : getSuggestions(word.toLowerCase(), 3, lang);
    if (suggs.length > 0) {
      seen.add(m.index);
      suggestions.push({
        original: word,
        corrected: suggs[0],
        offset: m.index,
        length: word.length,
        confidence: 0.75,
        type: "spelling",
        autoApply: false
      });
    }
  }
  for (const { trigger, full, compressed } of COMPRESSION_COMPLETIONS) {
    const re = new RegExp(trigger.source, "gi");
    let cm;
    while ((cm = re.exec(text)) !== null) {
      if (!seen.has(cm.index)) {
        seen.add(cm.index);
        suggestions.push({
          original: cm[0],
          corrected: compressed,
          offset: cm.index,
          length: cm[0].length,
          confidence: 0.9,
          type: "compression",
          autoApply: false
        });
      }
    }
  }
  return suggestions.sort((a, b) => a.offset - b.offset);
}
function applyAutocorrect(text, suggestion) {
  return text.slice(0, suggestion.offset) + suggestion.corrected + text.slice(suggestion.offset + suggestion.length);
}
function applyAllAutoCorrections(text) {
  const suggestions = getAutocorrectSuggestions(text, void 0, detectLanguage(text)).filter((s) => s.autoApply && s.confidence >= 0.95).sort((a, b) => b.offset - a.offset);
  let result = text;
  for (const s of suggestions) {
    result = applyAutocorrect(result, s);
  }
  return result;
}

// src/spell/adapters/LiteSpellAdapter.ts
var LiteSpellAdapter = class {
  constructor() {
    this.ready = true;
    // synchronous, always ready
    this.lang = "en";
  }
  setLanguage(lang) {
    this.lang = lang === "it" ? "it" : "en";
  }
  correct(word) {
    if (isCorrect(word, this.lang)) return true;
    if (this.lang === "it" && isCorrect(word, "en")) return true;
    return false;
  }
  suggest(word, max = 5) {
    return getSuggestions(word, max, this.lang);
  }
};

// src/spell/bigItalian.ts
var _set = null;
var _buckets = null;
var _lenBuckets = null;
var _globalRank = null;
var _loading = null;
var _personal = /* @__PURE__ */ new Set();
function isBigItalianReady() {
  return _set !== null;
}
function loadBigItalian() {
  if (_set) return Promise.resolve();
  if (_loading) return _loading;
  _loading = (async () => {
    const { IT_BIG_RAW } = await import('./dictionary.it.big-KQIBSBRG.js');
    const words = IT_BIG_RAW.split("\n");
    const set = /* @__PURE__ */ new Set();
    const buckets = /* @__PURE__ */ new Map();
    const lenBuckets = /* @__PURE__ */ new Map();
    const globalRank = /* @__PURE__ */ new Map();
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!w) continue;
      set.add(w);
      if (!globalRank.has(w)) globalRank.set(w, i);
      const key = w[0] + w.length;
      let b = buckets.get(key);
      if (!b) {
        b = [];
        buckets.set(key, b);
      }
      b.push(w);
      let lb = lenBuckets.get(w.length);
      if (!lb) {
        lb = [];
        lenBuckets.set(w.length, lb);
      }
      lb.push(w);
    }
    _set = set;
    _buckets = buckets;
    _lenBuckets = lenBuckets;
    _globalRank = globalRank;
  })();
  return _loading;
}
function correctItBig(word) {
  const w = word.toLowerCase();
  if (_personal.has(w)) return true;
  if (!_set) return null;
  if (_set.has(w)) return true;
  if (isLikelyRegularVerbForm(w, _set)) return true;
  return false;
}
function isLikelyRegularVerbForm(w, dict) {
  if (w.length < 6) return false;
  const areEndings = [
    "ino",
    "ano",
    "iamo",
    "ate",
    "ano",
    "avo",
    "avi",
    "ava",
    "avano",
    "avate",
    "er\xF2",
    "erai",
    "er\xE0",
    "eremo",
    "erete",
    "eranno",
    "assi",
    "asse",
    "assero",
    "ato",
    "ata",
    "ati",
    "ate",
    "ando",
    "i",
    "a",
    "o",
    "iate"
  ];
  for (const end of areEndings) {
    if (w.endsWith(end) && w.length - end.length >= 3) {
      const stem = w.slice(0, w.length - end.length);
      if (dict.has(stem + "are")) return true;
    }
  }
  const ireEndings = ["iscano", "iscono", "iscano", "iamo", "ito", "ita", "iti", "ite", "endo", "ir\xF2", "irono", "issi"];
  for (const end of ireEndings) {
    if (w.endsWith(end) && w.length - end.length >= 3) {
      const stem = w.slice(0, w.length - end.length).replace(/isc$/, "");
      if (dict.has(stem + "ire")) return true;
    }
  }
  return false;
}
function boundedLev(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev;
    prev = curr;
    curr = t;
  }
  return prev[lb];
}
function suggestItBig(word, max = 5) {
  if (!_buckets || !_lenBuckets) return null;
  const w = word.toLowerCase();
  if (w.length < 3) return [];
  const maxDist = w.length <= 4 ? 1 : 2;
  const fc = w[0];
  const found = [];
  for (let len = w.length - maxDist; len <= w.length + maxDist; len++) {
    if (len < 1) continue;
    const bucket = _buckets.get(fc + len);
    if (!bucket) continue;
    for (let i = 0; i < bucket.length; i++) {
      const cand = bucket[i];
      if (cand === w) return [];
      const d = boundedLev(w, cand, maxDist);
      if (d <= maxDist) found.push({ word: cand, dist: d, rank: i });
    }
  }
  const tier1Best = found.length > 0 ? Math.min(...found.map((f) => f.dist)) : Infinity;
  if (found.length === 0 || tier1Best >= maxDist) {
    for (let len = w.length - maxDist; len <= w.length + maxDist; len++) {
      if (len < 1) continue;
      const bucket = _lenBuckets.get(len);
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const cand = bucket[i];
        if (cand === w) return [];
        if (cand[0] === fc) continue;
        const d = boundedLev(w, cand, maxDist);
        if (d <= maxDist) found.push({ word: cand, dist: d, rank: i });
      }
    }
  }
  const qlen = w.length;
  const gr = _globalRank;
  const rankOf = (word2) => gr?.get(word2) ?? Number.MAX_SAFE_INTEGER;
  found.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    const ra = rankOf(a.word), rb = rankOf(b.word);
    if (ra !== rb) return ra - rb;
    const aLenMatch = a.word.length === qlen ? 0 : 1;
    const bLenMatch = b.word.length === qlen ? 0 : 1;
    return aLenMatch - bLenMatch;
  });
  return found.slice(0, max).map((c) => c.word);
}
function addPersonalWord(word) {
  const w = word.trim().toLowerCase();
  if (w) _personal.add(w);
}
function removePersonalWord(word) {
  _personal.delete(word.trim().toLowerCase());
}
function setPersonalWords(words) {
  _personal.clear();
  for (const w of words) {
    const t = w.trim().toLowerCase();
    if (t) _personal.add(t);
  }
}
function getPersonalWords() {
  return [..._personal];
}

// src/spell/adapters/NspellAdapter.ts
var NspellAdapter = class {
  constructor() {
    this._spellEn = null;
    this._liteFallback = new LiteSpellAdapter();
    // handles Italian (and anything else nspell doesn't cover here)
    this._activeLang = "en";
    this._ready = false;
    this._initPromise = this._init();
  }
  async _init() {
    void loadBigItalian().catch((err) => {
      console.warn("[promptlint] big Italian dictionary failed to load, staying on lite Italian:", err);
    });
    try {
      const [{ default: nspell }, { default: dicEn }] = await Promise.all([
        import('nspell'),
        import('dictionary-en')
      ]);
      this._spellEn = nspell(dicEn.aff, dicEn.dic);
      this._ready = true;
    } catch (err) {
      console.warn("[promptlint] English Hunspell dictionary failed to load, falling back to lite mode for English too:", err);
    }
  }
  /** Wait for both dictionaries. English via nspell; Italian's big list via
   *  bigItalian. Either can fail independently without rejecting — the
   *  adapter degrades to optimistic/lite behavior, never throws here. */
  async waitReady() {
    await Promise.all([
      this._initPromise,
      loadBigItalian().catch(() => {
      })
    ]);
  }
  get ready() {
    return this._ready || this._activeLang === "it";
  }
  setLanguage(lang) {
    this._activeLang = lang === "it" ? "it" : "en";
    this._liteFallback.setLanguage(this._activeLang);
  }
  correct(word) {
    if (this._activeLang === "it") {
      const big = correctItBig(word);
      const itOk = big !== null ? big : this._liteFallback.correct(word);
      if (itOk) return true;
      if (this._spellEn && this._spellEn.correct(word)) return true;
      return false;
    }
    if (!this._spellEn) return true;
    return this._spellEn.correct(word);
  }
  suggest(word, max = 5) {
    if (this._activeLang === "it") {
      const big = suggestItBig(word, max);
      return big !== null ? big : this._liteFallback.suggest(word, max);
    }
    if (!this._spellEn) return [];
    return this._spellEn.suggest(word).slice(0, max);
  }
  // ── Personal dictionary (Italian) ──
  // Portable: promptlint-core keeps these in memory; the host app persists
  // them. The single highest-value lever against residual false positives —
  // any real word the big list happens to miss becomes a one-click fix that
  // never recurs.
  addWord(word) {
    addPersonalWord(word);
  }
  removeWord(word) {
    removePersonalWord(word);
  }
  setPersonalDictionary(words) {
    setPersonalWords(words);
  }
  getPersonalDictionary() {
    return getPersonalWords();
  }
};
var _instance = null;
function getNspellAdapter() {
  if (!_instance) _instance = new NspellAdapter();
  return _instance;
}

// src/tokenizer/adapters/TiktokenAdapter.ts
var TiktokenAdapter = class {
  constructor(model = "gpt-4o") {
    this._enc = null;
    this._ready = false;
    this.encoding = "cl100k_base";
    this._initPromise = this._init(model);
  }
  async _init(model) {
    try {
      const { encodingForModel } = await import('js-tiktoken');
      this._enc = encodingForModel(model);
      this._ready = true;
    } catch (err) {
      console.warn("[promptlint] TiktokenAdapter failed, using lite estimator:", err);
    }
  }
  async waitReady() {
    return this._initPromise;
  }
  get ready() {
    return this._ready;
  }
  count(text) {
    if (!this._enc) {
      return estimateTokens(text);
    }
    return this._enc.encode(text).length;
  }
};
var _instance2 = null;
function getTiktokenAdapter(model = "gpt-4o") {
  if (!_instance2) _instance2 = new TiktokenAdapter(model);
  return _instance2;
}

// src/completion/index.ts
var PHRASE_RULES = [
  // Verbose constructions
  { trigger: /in order to\s*$/i, full: "in order to", compressed: "to", minChars: 11, tokensSaved: 2 },
  { trigger: /due to the fact that\s*$/i, full: "due to the fact that", compressed: "because", minChars: 16, tokensSaved: 4 },
  { trigger: /in the event that\s*$/i, full: "in the event that", compressed: "if", minChars: 15, tokensSaved: 3 },
  { trigger: /at this point in time\s*$/i, full: "at this point in time", compressed: "now", minChars: 18, tokensSaved: 4 },
  { trigger: /for the purpose of\s*$/i, full: "for the purpose of", compressed: "to", minChars: 16, tokensSaved: 3 },
  { trigger: /has the ability to\s*$/i, full: "has the ability to", compressed: "can", minChars: 17, tokensSaved: 3 },
  { trigger: /is able to\s*$/i, full: "is able to", compressed: "can", minChars: 9, tokensSaved: 2 },
  { trigger: /with regard to\s*$/i, full: "with regard to", compressed: "about", minChars: 12, tokensSaved: 2 },
  { trigger: /a large number of\s*$/i, full: "a large number of", compressed: "many", minChars: 15, tokensSaved: 3 },
  { trigger: /the fact that\s*$/i, full: "the fact that", compressed: "that", minChars: 12, tokensSaved: 2 },
  { trigger: /make use of\s*$/i, full: "make use of", compressed: "use", minChars: 10, tokensSaved: 2 },
  { trigger: /take into account\s*$/i, full: "take into account", compressed: "consider", minChars: 15, tokensSaved: 2 },
  { trigger: /in terms of\s*$/i, full: "in terms of", compressed: "for", minChars: 10, tokensSaved: 2 },
  { trigger: /each and every\s*$/i, full: "each and every", compressed: "each", minChars: 12, tokensSaved: 2 },
  { trigger: /first and foremost\s*$/i, full: "first and foremost", compressed: "first", minChars: 16, tokensSaved: 2 },
  { trigger: /as a matter of fact\s*$/i, full: "as a matter of fact", compressed: "in fact", minChars: 16, tokensSaved: 3 },
  { trigger: /needless to say\s*$/i, full: "needless to say", compressed: "", minChars: 13, tokensSaved: 3 },
  { trigger: /it goes without saying\s*$/i, full: "it goes without saying", compressed: "", minChars: 19, tokensSaved: 4 },
  { trigger: /at the end of the day\s*$/i, full: "at the end of the day", compressed: "ultimately", minChars: 19, tokensSaved: 3 },
  { trigger: /in spite of the fact that\s*$/i, full: "in spite of the fact that", compressed: "although", minChars: 20, tokensSaved: 5 },
  // Politeness patterns
  { trigger: /please (make sure|be sure) to\s*$/i, full: "please make sure to", compressed: "", minChars: 17, tokensSaved: 3 },
  { trigger: /i would like you to\s*$/i, full: "i would like you to", compressed: "", minChars: 18, tokensSaved: 4 },
  { trigger: /could you please\s*$/i, full: "could you please", compressed: "", minChars: 14, tokensSaved: 2 },
  // Synonym pairs
  { trigger: /end result\s*$/i, full: "end result", compressed: "result", minChars: 9, tokensSaved: 1 },
  { trigger: /past history\s*$/i, full: "past history", compressed: "history", minChars: 11, tokensSaved: 1 },
  { trigger: /future plans\s*$/i, full: "future plans", compressed: "plans", minChars: 11, tokensSaved: 1 },
  { trigger: /join together\s*$/i, full: "join together", compressed: "join", minChars: 12, tokensSaved: 1 },
  { trigger: /repeat again\s*$/i, full: "repeat again", compressed: "repeat", minChars: 11, tokensSaved: 1 },
  { trigger: /revert back\s*$/i, full: "revert back", compressed: "revert", minChars: 10, tokensSaved: 1 }
];
var PARTIAL_RULES = [
  { prefix: /\bin ord/i, full: "in order to", compressed: "to" },
  { prefix: /\bdue to the/i, full: "due to the fact that", compressed: "because" },
  { prefix: /\bhas the abi/i, full: "has the ability to", compressed: "can" },
  { prefix: /\ba large num/i, full: "a large number of", compressed: "many" },
  { prefix: /\bmake use/i, full: "make use of", compressed: "use" },
  { prefix: /\btake into/i, full: "take into account", compressed: "consider" },
  { prefix: /\beat and eve/i, full: "each and every", compressed: "each" }
];
function getTabCompletion(text, cursorPos) {
  const before = text.slice(0, cursorPos);
  for (const rule of PHRASE_RULES) {
    const match = before.match(rule.trigger);
    if (match && before.length >= rule.minChars) {
      const matchStart = before.length - match[0].length;
      const ghost = rule.compressed ? `\u2192 ${rule.compressed}` : "\u2192 (remove)";
      return {
        ghostText: ghost,
        replacement: rule.compressed,
        replaceFrom: matchStart,
        replaceTo: cursorPos,
        type: "compression",
        confidence: 0.95,
        tokensSaved: rule.tokensSaved
      };
    }
  }
  for (const rule of PARTIAL_RULES) {
    const match = before.match(rule.prefix);
    if (match) {
      const matchStart = before.lastIndexOf(match[0]);
      const typed = before.slice(matchStart);
      const remaining = rule.full.slice(typed.length);
      const ghost = remaining ? `${remaining} \u2192 ${rule.compressed}` : `\u2192 ${rule.compressed}`;
      return {
        ghostText: ghost,
        replacement: rule.compressed,
        replaceFrom: matchStart,
        replaceTo: cursorPos,
        type: "compression",
        confidence: 0.8,
        tokensSaved: 1
      };
    }
  }
  const wordMatch = before.match(new RegExp(`(?<![${WORD_LETTER}])([${WORD_LETTER}]{4,})$`));
  if (wordMatch) {
    const partialWord = wordMatch[1];
    const wordStart = cursorPos - partialWord.length;
    const prevChar = wordStart > 0 ? text[wordStart - 1] : "";
    if (prevChar === "'" || prevChar === "\u2019" || prevChar === "\u2018") return null;
    const lang = detectLanguage(text);
    const autocorrect = getAutocorrectSuggestions(partialWord, void 0, lang);
    const spellHit = autocorrect.find(
      (s) => s.type === "spelling" && s.original.toLowerCase() === partialWord.toLowerCase() && s.corrected !== partialWord
    );
    if (spellHit && spellHit.confidence >= 0.75) {
      return {
        ghostText: `\u2192 ${spellHit.corrected}`,
        replacement: spellHit.corrected,
        replaceFrom: wordStart,
        replaceTo: cursorPos,
        type: "spelling",
        confidence: spellHit.confidence,
        tokensSaved: 0
      };
    }
  }
  return null;
}
function applyTabCompletion(text, suggestion) {
  const before = text.slice(0, suggestion.replaceFrom);
  const after = text.slice(suggestion.replaceTo);
  let newBefore = before;
  if (!suggestion.replacement && newBefore.endsWith(" ")) {
    newBefore = newBefore.trimEnd();
  }
  const newText = newBefore + suggestion.replacement + after;
  const cleaned = newText.replace(/  +/g, " ");
  const cursorPos = newBefore.length + suggestion.replacement.length;
  return { text: cleaned, cursorPos };
}

// src/index.full.ts
function buildResult(text, spell, tokenizer, langState, options = {}) {
  const start = Date.now();
  const {
    modelPrices = DEFAULT_PRICES,
    outputRatio = 2,
    disabledRules = [],
    autocorrect: includeAutocorrect = true
  } = options;
  if (!text?.trim()) {
    return {
      text,
      observations: [],
      byLine: /* @__PURE__ */ new Map(),
      byType: /* @__PURE__ */ new Map(),
      tokens: analyzeTokens(""),
      score: { total: 0, label: "poor", dimensions: {}, summary: "Prompt vuoto." },
      costs: [],
      potentialSavings: 0,
      compressedText: "",
      autocorrect: [],
      analysisDurationMs: 0
    };
  }
  const tokenCount = tokenizer.count(text);
  const cheapestInputRate = Math.min(...modelPrices.map((m) => m.inputPer1M));
  const observations = runAllObservations(text, disabledRules, spell, cheapestInputRate, langState);
  const tokens = analyzeTokens(text);
  if (tokenizer.ready) tokens.tokenCount = tokenCount;
  const score = scorePrompt(text, observations, tokens);
  const costs = estimateCosts(tokenCount, outputRatio, modelPrices);
  const autocorrect = includeAutocorrect ? getAutocorrectSuggestions(text, spell, langState.lastLang) : [];
  const potentialSavings = observations.reduce((n, o) => n + o.impact.tokensSaved, 0);
  const byLine = /* @__PURE__ */ new Map();
  const byType = /* @__PURE__ */ new Map();
  for (const o of observations) {
    if (!byLine.has(o.line)) byLine.set(o.line, []);
    byLine.get(o.line).push(o);
    if (!byType.has(o.type)) byType.set(o.type, []);
    byType.get(o.type).push(o);
  }
  return {
    text,
    observations,
    byLine,
    byType,
    tokens,
    score,
    costs,
    potentialSavings,
    // Was hardcoded to `text` (no computation attempt at all) — this build
    // never produced a compressed prompt. See src/compression/index.ts.
    compressedText: compressText(text, observations),
    autocorrect,
    analysisDurationMs: Date.now() - start
  };
}
function createAnalyzer(options) {
  const spell = options?.spellAdapter ?? getNspellAdapter();
  const tokenizer = getTiktokenAdapter();
  const langState = makeLangState();
  return {
    async ready() {
      await Promise.all([
        spell.waitReady?.(),
        tokenizer.waitReady?.()
      ]);
    },
    get isReady() {
      return spell.ready && tokenizer.ready;
    },
    analyze(text, options2) {
      return buildResult(text, spell, tokenizer, langState, options2);
    },
    resetLanguage() {
      langState.lastLang = "en";
    }
  };
}
var _default = createAnalyzer();
function analyze(text, options) {
  return _default.analyze(text, options);
}

export { DEFAULT_PRICES, addPersonalWord, analyze, analyzeTokens, applyAllAutoCorrections, applyAutocorrect, applyTabCompletion, createAnalyzer, detectLanguage, estimateCosts, estimateTokens, formatCost, getAutocorrectSuggestions, getNspellAdapter, getPersonalWords, getSuggestions, getTabCompletion, getTiktokenAdapter, getWordAtCursor, isBigItalianReady, isCorrect, loadBigItalian, makeLangState, removePersonalWord, resetLanguageState, runAllObservations, scorePrompt, setPersonalWords, splitSentences };
//# sourceMappingURL=index.full.js.map
//# sourceMappingURL=index.full.js.map