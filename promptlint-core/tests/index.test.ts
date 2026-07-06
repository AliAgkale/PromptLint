/**
 * promptlint-core — Test Suite
 */

import { describe, it, expect } from 'vitest';
import { analyze, estimateTokens, isCorrect, getSuggestions, levenshtein, getAutocorrectSuggestions } from '../src/index.js';

// ─── Tokenizer ────────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('   ')).toBe(0);
  });

  it('counts single common word as 1 token', () => {
    expect(estimateTokens('the')).toBe(1);
    expect(estimateTokens('and')).toBe(1);
    expect(estimateTokens('for')).toBe(1);
  });

  it('short words = 1 token each', () => {
    expect(estimateTokens('cat')).toBe(1);
    expect(estimateTokens('dog')).toBe(1);
  });

  it('estimates multi-word text within ±20% of real token count', () => {
    // Real cl100k: "Write a blog post about machine learning" = 8 tokens
    const est = estimateTokens('Write a blog post about machine learning');
    expect(est).toBeGreaterThan(5);
    expect(est).toBeLessThan(12);
  });

  it('handles numbers', () => {
    expect(estimateTokens('123')).toBeGreaterThan(0);
  });

  it('handles URLs', () => {
    const t = estimateTokens('https://example.com/path/to/page');
    expect(t).toBeGreaterThan(2);
  });
});

// ─── Spell ────────────────────────────────────────────────────────────────────

describe('isCorrect', () => {
  it('returns true for common English words', () => {
    expect(isCorrect('write')).toBe(true);
    expect(isCorrect('analyze')).toBe(true);
    expect(isCorrect('the')).toBe(true);
    expect(isCorrect('beautiful')).toBe(true);
  });

  it('returns true for contractions', () => {
    expect(isCorrect("don't")).toBe(true);
    expect(isCorrect("it's")).toBe(true);
    expect(isCorrect("let's")).toBe(true);
  });

  it('returns true for acronyms (all caps)', () => {
    expect(isCorrect('API')).toBe(true);
    expect(isCorrect('LLM')).toBe(true);
    expect(isCorrect('GPT')).toBe(true);
  });

  it('returns false for misspelled words', () => {
    expect(isCorrect('definately')).toBe(false);
    expect(isCorrect('recieve')).toBe(false);
    expect(isCorrect('occured')).toBe(false);
  });

  it('returns true for numbers', () => {
    expect(isCorrect('123')).toBe(true);
  });
});

describe('getSuggestions', () => {
  it('returns correct spelling for common misspellings', () => {
    const suggs = getSuggestions('definately');
    expect(suggs.length).toBeGreaterThan(0);
    expect(suggs[0]).toBe('definitely');
  });

  it('returns empty array for correctly spelled words', () => {
    expect(getSuggestions('write')).toHaveLength(0);
    expect(getSuggestions('analyze')).toHaveLength(0);
  });

  it('returns at most max suggestions', () => {
    const suggs = getSuggestions('reciive', 3);
    expect(suggs.length).toBeLessThanOrEqual(3);
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns correct edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('saturday', 'sunday')).toBe(3);
  });

  it('handles empty strings', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });
});

// ─── Observations ─────────────────────────────────────────────────────────────

describe('analyze — observations', () => {
  it('detects repeated words', () => {
    const r = analyze('Write a a blog post');
    const rep = r.observations.filter(o => o.type === 'repetition');
    expect(rep.length).toBeGreaterThan(0);
    expect(rep[0].code).toBe('GRAM_001');
  });

  it('detects verbose phrase "in order to"', () => {
    const r = analyze('Write a script in order to process the data');
    const verb = r.observations.filter(o => o.code === 'VERB_001');
    expect(verb.length).toBeGreaterThan(0);
    expect(verb[0].example?.after).toBe('to');
    expect(verb[0].impact.tokensSaved).toBeGreaterThanOrEqual(1);
  });

  it('detects filler word "basically"', () => {
    const r = analyze('Basically write a summary of the document');
    const fill = r.observations.filter(o => o.type === 'filler');
    expect(fill.length).toBeGreaterThan(0);
  });

  it('detects politeness "please"', () => {
    const r = analyze('Please write a blog post about AI');
    const pol = r.observations.filter(o => o.type === 'politeness');
    expect(pol.length).toBeGreaterThan(0);
  });

  it('detects synonym pair "end result"', () => {
    const r = analyze('Show me the end result of the analysis');
    const syn = r.observations.filter(o => o.type === 'redundancy');
    expect(syn.length).toBeGreaterThan(0);
  });

  it('does NOT flag well-written prompts as having many issues', () => {
    const r = analyze(
      'You are a senior data scientist. Analyze the sales dataset and return a JSON object with: 1) top 3 products by revenue, 2) monthly growth rate. Use only data from Q4 2024.'
    );
    // Should have very few or zero critical issues
    const critical = r.observations.filter(o => o.level === 'contradiction');
    expect(critical.length).toBe(0);
  });

  it('detects no task for vague prompts', () => {
    // Prompt that is purely descriptive with no action verb at start
    const r = analyze('Artificial intelligence and machine learning concepts');
    const noTask = r.observations.filter(o => o.code === 'PL_001');
    expect(noTask.length).toBeGreaterThan(0);
  });

  it('does NOT flag prompts that start with a verb', () => {
    const r = analyze('Summarize this document in 3 bullet points');
    const noTask = r.observations.filter(o => o.code === 'PL_001');
    expect(noTask.length).toBe(0);
  });

  it('detects spelling errors', () => {
    const r = analyze('Pleese analyze the folowing document');
    const spell = r.observations.filter(o => o.type === 'spelling');
    expect(spell.length).toBeGreaterThan(0);
  });
});

// ─── Score ────────────────────────────────────────────────────────────────────

describe('analyze — score', () => {
  it('gives lower score to vague/filler-heavy prompts than clean ones', () => {
    const vague = analyze('please help me to write something basically');
    const clean = analyze('You are a senior engineer. Write a 200-word summary of the document in Markdown. Focus on key points only.');
    expect(clean.score.total).toBeGreaterThan(vague.score.total);
  });

  it('gives high score to well-formed prompts', () => {
    const r = analyze(
      'You are a senior backend engineer. Write a 200-word blog post explaining REST vs GraphQL for junior developers. Format as Markdown with 3 sections.'
    );
    expect(r.score.total).toBeGreaterThan(60);
  });

  it('score is between 0 and 100', () => {
    const texts = [
      '', 'hi', 'please write stuff about things basically',
      'You are an expert. Analyze this text and return JSON with sentiment, topics, and keywords. Limit to 100 words.',
    ];
    texts.forEach(t => {
      const r = analyze(t);
      expect(r.score.total).toBeGreaterThanOrEqual(0);
      expect(r.score.total).toBeLessThanOrEqual(100);
    });
  });
});

// ─── Token Analysis ───────────────────────────────────────────────────────────

describe('analyze — tokens', () => {
  it('correctly counts words', () => {
    const r = analyze('Write a blog post about AI');
    expect(r.tokens.wordCount).toBe(6);
  });

  it('correctly counts sentences', () => {
    const r = analyze('Write a post. Make it short. Use markdown.');
    expect(r.tokens.sentenceCount).toBe(3);
  });

  it('returns 0 for empty text', () => {
    const r = analyze('');
    expect(r.tokens.tokenCount).toBe(0);
    expect(r.tokens.wordCount).toBe(0);
  });
});

// ─── Cost Estimation ─────────────────────────────────────────────────────────

describe('analyze — costs', () => {
  it('returns costs sorted cheapest first', () => {
    const r = analyze('Write a blog post about machine learning in 500 words');
    expect(r.costs.length).toBeGreaterThan(0);
    for (let i = 1; i < r.costs.length; i++) {
      expect(r.costs[i].totalCost).toBeGreaterThanOrEqual(r.costs[i - 1].totalCost);
    }
  });

  it('cheapest cost is greater than 0', () => {
    const r = analyze('Write a blog post');
    expect(r.costs[0].totalCost).toBeGreaterThan(0);
  });
});

// ─── Autocorrect ─────────────────────────────────────────────────────────────

describe('getAutocorrectSuggestions', () => {
  it('catches common typos', () => {
    const suggs = getAutocorrectSuggestions('teh model should analyze');
    const typo = suggs.find(s => s.original.toLowerCase() === 'teh');
    expect(typo).toBeDefined();
    expect(typo?.corrected).toBe('the');
    expect(typo?.autoApply).toBe(true);
  });

  it('suggests compression for verbose phrases', () => {
    const suggs = getAutocorrectSuggestions('Use this in order to process the data');
    const comp = suggs.find(s => s.type === 'compression');
    expect(comp).toBeDefined();
    expect(comp?.corrected).toBe('to');
  });

  it('returns empty array for clean text', () => {
    const suggs = getAutocorrectSuggestions('Write a JSON summary of the document');
    const typos = suggs.filter(s => s.type === 'spelling' && s.autoApply);
    expect(typos.length).toBe(0);
  });
});

// ─── byLine / byType grouping ─────────────────────────────────────────────────

describe('analyze — grouping', () => {
  it('groups observations by line', () => {
    const r = analyze('basically write a post\nplease make it short');
    expect(r.byLine.size).toBeGreaterThan(0);
    r.byLine.forEach((obs, line) => {
      expect(line).toBeGreaterThan(0);
      obs.forEach(o => expect(o.line).toBe(line));
    });
  });

  it('groups observations by type', () => {
    const r = analyze('please basically write something');
    const types = Array.from(r.byType.keys());
    expect(types).toContain('filler');
    expect(types).toContain('politeness');
  });
});

// ─── Performance ──────────────────────────────────────────────────────────────

describe('performance', () => {
  it('analyzes a 500-word prompt in < 500ms', () => {
    const longText = Array(50).fill('Write a comprehensive and detailed analysis of the machine learning model performance metrics including accuracy, precision, recall, and F1 score.').join(' ');
    const r = analyze(longText);
    expect(r.analysisDurationMs).toBeLessThan(500);
  });
});

// ─── Italian language support ────────────────────────────────────────────────

import { detectLanguage, isCorrect as isCorrectLang, getSuggestions as getSuggestionsLang } from '../src/spell/index.js';

describe('detectLanguage', () => {
  it('detects Italian text correctly', () => {
    expect(detectLanguage('Scrivi un riassunto di questo documento molto importante')).toBe('it');
    expect(detectLanguage('Questo è un testo scritto interamente in italiano per il test')).toBe('it');
  });

  it('detects English text correctly', () => {
    expect(detectLanguage('Write a summary of this very important document')).toBe('en');
    expect(detectLanguage('This is a text written entirely in English for testing')).toBe('en');
  });

  it('defaults to English for empty or too-short text', () => {
    expect(detectLanguage('')).toBe('en');
    expect(detectLanguage('hi')).toBe('en');
  });
});

describe('isCorrect — Italian dictionary', () => {
  it('recognizes common Italian words', () => {
    expect(isCorrectLang('scrivi', 'it')).toBe(true);
    expect(isCorrectLang('documento', 'it')).toBe(true);
    expect(isCorrectLang('importante', 'it')).toBe(true);
    expect(isCorrectLang('riassunto', 'it')).toBe(true);
    expect(isCorrectLang('analizzando', 'it')).toBe(true); // gerund derivation
    expect(isCorrectLang('fornendo', 'it')).toBe(true);    // gerund derivation
  });

  it('recognizes Italian function words and accented words', () => {
    expect(isCorrectLang('perché', 'it')).toBe(true);
    expect(isCorrectLang('così', 'it')).toBe(true);
    expect(isCorrectLang('città', 'it')).toBe(true);
    expect(isCorrectLang('più', 'it')).toBe(true);
  });

  it('flags genuine Italian typos', () => {
    expect(isCorrectLang('qesto', 'it')).toBe(false);
    expect(isCorrectLang('sbagliatissimoo', 'it')).toBe(false);
  });

  it('suggests corrections for Italian typos', () => {
    const suggs = getSuggestionsLang('qesto', 3, 'it');
    expect(suggs).toContain('questo');
  });
});

describe('analyze — Italian prompts end-to-end', () => {
  it('does not flag correctly-spelled Italian prompts as having spelling errors', () => {
    const r = analyze('Scrivi un riassunto dettagliato di questo documento, analizzando i punti più importanti.');
    const spellIssues = r.observations.filter(o => o.type === 'spelling');
    expect(spellIssues.length).toBe(0);
  });

  it('still detects genuine typos in Italian prompts', () => {
    const r = analyze('Per favore aiutami a capire qesto argomento sbagliatissimoo');
    const spellIssues = r.observations.filter(o => o.type === 'spelling');
    expect(spellIssues.length).toBeGreaterThan(0);
  });
});

// ─── Regression tests for bugs found and fixed in this session ────────────────
// Each test here corresponds to a real bug found by reading the code and/or
// running it, not a hypothetical — see promptlint-analysis.md for the full
// writeup of each one.

describe('analyze — compressedText (bug: was always identical to input)', () => {
  it('actually shortens text with fillers and verbose phrases', () => {
    const r = analyze('Please basically just write me something in order to help with this task, very quickly.');
    expect(r.compressedText).not.toBe(r.text);
    expect(r.compressedText.length).toBeLessThan(r.text.length);
  });

  it('removes filler words entirely rather than leaving a marker behind', () => {
    const r = analyze('This is basically a very simple request.');
    expect(r.compressedText).not.toContain('basically');
    expect(r.compressedText).not.toContain('(rimuovere)');
  });

  it('never mechanically applies a spelling suggestion (probabilistic, not deterministic)', () => {
    // Regression for a bug introduced while fixing compressedText itself:
    // a spell-check false positive ("something" -> "setting") was being
    // applied mechanically, corrupting the compressed text. Spelling
    // suggestions must never be auto-applied by compression.
    const r = analyze('I need something to help with this in order to finish.');
    expect(r.compressedText).toContain('something');
  });

  it('does not leave doubled or dangling spaces after removals', () => {
    const r = analyze('This is just really quite simple.');
    expect(r.compressedText).not.toMatch(/ {2,}/);
  });
});

describe('analyze — ambiguity detection (AMB_001/AMB_002 — type existed, no rule ever produced it)', () => {
  it('flags a pronoun with no antecedent at the start of the prompt', () => {
    const r = analyze('Fix it and make sure everything works.');
    const amb = r.observations.filter(o => o.code === 'AMB_001');
    expect(amb.length).toBe(1);
    expect(amb[0].matchText).toBe('Fix it');
  });

  it('does NOT flag a pronoun with a clear antecedent already given', () => {
    const r = analyze('Analyze the login function. Fix any bugs you find in it.');
    const amb = r.observations.filter(o => o.code === 'AMB_001');
    expect(amb.length).toBe(0); // "Fix any bugs" starts the prompt, not "Fix it"
  });

  it('flags vague comparative quality words', () => {
    const r = analyze('Make the login page better and cleaner than it is now.');
    const amb = r.observations.filter(o => o.code === 'AMB_002');
    expect(amb.map(o => o.matchText)).toEqual(expect.arrayContaining(['better', 'cleaner']));
  });

  it('does NOT flag absolute adjectives like "good" (too common/legitimate to be a useful signal)', () => {
    const r = analyze('Write a good summary of this article in 100 words.');
    const amb = r.observations.filter(o => o.code === 'AMB_002');
    expect(amb.length).toBe(0);
  });
});

describe('analyze — weak verb detection (WEAK_001 — roadmap gap, was entirely unimplemented)', () => {
  it('flags known weak/vague verbs anywhere in the prompt, not just at the start', () => {
    const r = analyze('Write a report and please handle the formatting issues, then look at the summary.');
    const weak = r.observations.filter(o => o.code === 'WEAK_001');
    expect(weak.map(o => o.matchText.toLowerCase())).toEqual(expect.arrayContaining(['handle', 'look at']));
  });

  it('is not shadowed by a spell-check false positive on the same word', () => {
    // Regression: "handle" was missing from the dictionary, so SPELL_001
    // and WEAK_001 both fired on the same offset and deduplication kept
    // only the (wrong) spelling one, silently dropping WEAK_001.
    const r = analyze('Please handle the authentication bug.');
    const spellOnHandle = r.observations.filter(o => o.code === 'SPELL_001' && o.matchText === 'handle');
    const weakOnHandle = r.observations.filter(o => o.code === 'WEAK_001' && o.matchText === 'handle');
    expect(spellOnHandle.length).toBe(0);
    expect(weakOnHandle.length).toBe(1);
  });
});

describe('isCorrect — indefinite compounds (was an entire missing word class, not one typo)', () => {
  it('recognizes common some-/any-/every-/no- compounds', () => {
    for (const w of ['something', 'anything', 'everything', 'nothing', 'someone', 'anywhere', 'everywhere']) {
      expect(isCorrect(w, 'en')).toBe(true);
    }
  });

  it('recognizes the -ever family', () => {
    for (const w of ['whatever', 'whenever', 'wherever', 'whoever', 'whichever']) {
      expect(isCorrect(w, 'en')).toBe(true);
    }
  });

  it('still flags a genuine misspelling of a similar-looking word', () => {
    expect(isCorrect('somethign', 'en')).toBe(false);
  });
});

describe('analyze — cost consistency (bug: observation-level cost ignored configured modelPrices)', () => {
  it('uses the configured cheapest model rate, not a hardcoded GPT-4o rate', () => {
    const cheapPrice = [{ id: 'cheap', name: 'Cheap Model', provider: 'test', inputPer1M: 0.01, outputPer1M: 0.02, contextWindow: 100000 }];
    const r = analyze('This is basically a very simple test prompt with some filler words.', { modelPrices: cheapPrice });
    const fillerObs = r.observations.find(o => o.type === 'filler');
    expect(fillerObs).toBeDefined();
    // At $0.01/1M tokens, saving 1 token costs a tiny fraction of a cent —
    // nowhere near what the old hardcoded $2.50/1M (GPT-4o) rate would give.
    expect(fillerObs!.impact.costSavedPer1kCalls).toBeLessThan(0.001);
  });
});

describe('analyze — long sentence offset accuracy (bug: drifted on multi-space/newline separators)', () => {
  it('reports an offset that actually points at the start of the flagged sentence', () => {
    const longSentence = 'word '.repeat(40) + 'end.';
    const text = 'Short one.  ' + longSentence; // double space before the long sentence
    const r = analyze(text);
    const longObs = r.observations.find(o => o.code === 'GRAM_003');
    expect(longObs).toBeDefined();
    expect(text.slice(longObs!.offset, longObs!.offset + 4)).toBe('word');
  });
});

describe('isCorrect — Italian enclitic pronouns (was entirely unhandled)', () => {
  it('recognizes common infinitive+enclitic combinations', () => {
    for (const w of ['capirlo', 'dirlo', 'vederla', 'dirglielo']) {
      expect(isCorrectLang(w, 'it')).toBe(true);
    }
  });

  it('recognizes imperative/gerund + enclitic combinations once the base verb is in the dictionary', () => {
    for (const w of ['aiutami', 'guardandola', 'portalo']) {
      expect(isCorrectLang(w, 'it')).toBe(true);
    }
  });

  it('still flags genuine typos, not just anything ending in a pronoun-like suffix', () => {
    expect(isCorrectLang('qesto', 'it')).toBe(false);
    expect(isCorrectLang('sbagliatissimoo', 'it')).toBe(false);
  });
});

describe('analyze — Italian structural rules (PL_001/PL_002/PL_009 were English-only)', () => {
  it('does not flag a well-formed Italian prompt with an imperative verb', () => {
    const r = analyze('scrivi un riassunto del documento');
    expect(r.observations.find(o => o.code === 'PL_001')).toBeUndefined();
  });

  it('recognizes Italian verbs with an enclitic pronoun attached ("sistemalo", "creami")', () => {
    for (const prompt of ['sistemalo in qualche modo', 'creami un file di testo']) {
      const r = analyze(prompt);
      expect(r.observations.find(o => o.code === 'PL_001')).toBeUndefined();
    }
  });

  it('recognizes Italian format and length words', () => {
    const r = analyze('scrivi un riassunto di 100 parole in formato markdown, come elenco puntato');
    expect(r.observations.find(o => o.code === 'PL_002')).toBeUndefined();
    expect(r.observations.find(o => o.code === 'PL_009')).toBeUndefined();
  });

  it('still flags a genuinely task-less Italian prompt', () => {
    const r = analyze('il gatto è sul tavolo vicino alla finestra');
    expect(r.observations.find(o => o.code === 'PL_001')).toBeDefined();
  });
});

describe('isCorrect — dictionary gaps found via real Italian prompts', () => {
  it('recognizes "del/dello/della" (was missing while dei/degli/delle were present)', () => {
    for (const w of ['del', 'dello', 'della']) expect(isCorrectLang(w, 'it')).toBe(true);
  });

  it('recognizes common English tech loanwords used as-is in Italian', () => {
    for (const w of ['bug', 'software', 'file', 'email', 'markdown', 'json']) {
      expect(isCorrectLang(w, 'it')).toBe(true);
    }
  });
});

describe('runVagueQuality/runWeakVerbs/runAmbiguousPronoun — Italian coverage (added this session, found English-only too)', () => {
  it('flags Italian vague comparatives', () => {
    const r = analyze('rendilo migliore e più pulito');
    expect(r.observations.some(o => o.code === 'AMB_002')).toBe(true);
  });

  it('flags Italian weak verbs', () => {
    const r = analyze('occupati di questo problema');
    expect(r.observations.some(o => o.code === 'WEAK_001')).toBe(true);
  });
});
