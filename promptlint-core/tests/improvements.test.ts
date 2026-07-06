/**
 * promptlint-core — Regression tests for v2.5.0
 *
 * Every describe block below corresponds to a real, demonstrated bug or a
 * deliberate behavior addition. Tests target the CLASS of each bug (e.g.
 * "the -zione/-zioni plural family", "accented words in every extraction
 * path"), not just the single instance that surfaced it — per this
 * project's own working style.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  isCorrect, getSuggestions,
  getAutocorrectSuggestions, applyAllAutoCorrections,
} from '../src/index.js';
import { runAllObservations, makeLangState } from '../src/analyzers/observations.js';
import { detectLanguage } from '../src/spell/index.js';
import { getWordAtCursor } from '../src/autocorrect/index.js';
import { getTabCompletion } from '../src/completion/index.js';
import { wordRegex, isWordChar, wholeWord } from '../src/spell/index.js';

// ─── Bug 1: plurali in -i delle parole in -e ─────────────────────────────────
// Prima del fix, l'INTERA classe -e→-i (funzione→funzioni) veniva segnalata
// come errore: mancava la regola morfologica [/i$/, 'e'].

describe('Italian -e→-i plurals (SUFFIX_RULES_IT gap)', () => {
  const pluralsOfEWords = [
    'funzioni', 'versioni', 'opzioni', 'informazioni', 'condizioni',
    'istruzioni', 'soluzioni', 'descrizioni', 'situazioni', 'operazioni',
    'notti', 'chiavi', 'frasi', 'classi', 'reti',
  ];

  for (const word of pluralsOfEWords) {
    it(`accepts "${word}"`, () => {
      expect(isCorrect(word, 'it')).toBe(true);
    });
  }

  it('still flags actual misspellings ending in -i', () => {
    expect(isCorrect('funzzioni', 'it')).toBe(false);
    expect(isCorrect('versoini', 'it')).toBe(false);
  });
});

// ─── Bug 2: parole accentate troncate nell'estrazione ───────────────────────
// La regex ASCII-only troncava "perché"→"perch" in autocorrect e completion
// (già corretta in observations). Ora c'è una definizione condivisa.

describe('accented-word extraction (shared WORD_LETTER)', () => {
  it('wordRegex extracts accented words whole, not truncated', () => {
    const words = 'perché la funzionalità è così però'.match(wordRegex()) ?? [];
    expect(words).toContain('perché');
    expect(words).toContain('funzionalità');
    expect(words).toContain('però');
    expect(words).not.toContain('perch');
    expect(words).not.toContain('funzionalit');
  });

  it('isWordChar treats accented letters as word characters', () => {
    for (const ch of ['é', 'à', 'ò', 'ù', 'è', 'ì']) expect(isWordChar(ch)).toBe(true);
    for (const ch of [' ', '.', ',', '!']) expect(isWordChar(ch)).toBe(false);
  });

  it('getAutocorrectSuggestions does not flag correct accented Italian words', () => {
    const text = 'perché la funzionalità è così importante';
    const spellingHits = getAutocorrectSuggestions(text, undefined, 'it')
      .filter(s => s.type === 'spelling');
    expect(spellingHits).toHaveLength(0);
  });

  it('getWordAtCursor returns whole accented words', () => {
    const text = 'dimmi perché succede';
    // cursor in mezzo a "perché" (offset 9 = dopo la r)
    const hit = getWordAtCursor(text, 9);
    expect(hit?.word).toBe('perché');
  });

  it('ghost-text tier does not treat a truncated accent prefix as a misspelling', () => {
    // Mentre l'utente digita "perché", al momento di "perch" il vecchio
    // codice estraeva una "parola completa" errata e poteva suggerire una
    // correzione fasulla di tipo spelling.
    const suggestion = getTabCompletion('spiegami perché', 'spiegami perché'.length);
    if (suggestion) expect(suggestion.type).not.toBe('spelling');
  });
});

// ─── TYPO_MAP: gate per lingua + refusi italiani ─────────────────────────────

describe('language-gated auto-apply typos', () => {
  it('fixes the Italian -chè family (autoApply)', () => {
    const s = getAutocorrectSuggestions('dimmi perchè succede', undefined, 'it');
    const fix = s.find(x => x.original === 'perchè');
    expect(fix).toBeDefined();
    expect(fix!.corrected).toBe('perché');
    expect(fix!.autoApply).toBe(true);
  });

  it('preserves capitalization when auto-applying', () => {
    const s = getAutocorrectSuggestions('Perchè succede?', undefined, 'it');
    const fix = s.find(x => x.original === 'Perchè');
    expect(fix?.corrected).toBe('Perché');
  });

  it('matches accented typos as whole words despite \\b limitations', () => {
    // /\bpò\b/ non può MAI matchare (ò non è \w) — wholeWord sì.
    expect(wholeWord('pò').test('un pò di testo')).toBe(true);
    expect(wholeWord('pò').test('capò')).toBe(false); // dentro un'altra parola: no
    const s = getAutocorrectSuggestions('aspetta un pò', undefined, 'it');
    expect(s.find(x => x.original === 'pò')?.corrected).toBe("po'");
  });

  it('does NOT apply English typo rules to Italian text', () => {
    // "cant" è un tasto di prova: la mappa EN lo correggerebbe in "can't".
    const s = getAutocorrectSuggestions('il cant o della sirena', undefined, 'it');
    expect(s.find(x => x.original.toLowerCase() === 'cant' && x.autoApply)).toBeUndefined();
  });

  it('does NOT apply Italian typo rules to English text', () => {
    const s = getAutocorrectSuggestions('perchè is not an english word', undefined, 'en');
    expect(s.find(x => x.original === 'perchè' && x.autoApply)).toBeUndefined();
  });

  it('applyAllAutoCorrections detects language on its own', () => {
    const out = applyAllAutoCorrections('spiegami perchè il codice non funziona e cosa devo fare');
    expect(out).toContain('perché');
  });
});

// ─── Regole italiane: verbosità, filler, cortesia, ridondanza ────────────────

describe('Italian rule coverage (FILL/VERB/SYN/POL _1xx series)', () => {
  const analyzeIt = (text: string) =>
    runAllObservations(text, [], undefined, 2.5, makeLangState());

  it('flags "al fine di" as verbose with "per" as replacement', () => {
    const obs = analyzeIt('Scrivi una email al fine di ottenere una risposta dal cliente');
    const hit = obs.find(o => o.code === 'VERB_101');
    expect(hit).toBeDefined();
    expect(hit!.example?.after).toBe('per');
  });

  it('flags Italian fillers ("praticamente", "in pratica")', () => {
    const obs = analyzeIt('Spiegami praticamente come funziona in pratica questo sistema di codice');
    expect(obs.some(o => o.code === 'FILL_101')).toBe(true);
    expect(obs.some(o => o.code === 'FILL_104')).toBe(true);
  });

  it('flags Italian politeness ("per favore", "potresti per favore")', () => {
    const obs = analyzeIt('Potresti per favore scrivere il codice della funzione principale');
    expect(obs.some(o => o.code === 'POL_101' || o.code === 'POL_102')).toBe(true);
  });

  it('does NOT flag bare "potresti" (normal conditional, not politeness)', () => {
    const obs = analyzeIt('Elenca i problemi che potresti incontrare durante la migrazione del database');
    expect(obs.some(o => o.type === 'politeness')).toBe(false);
  });

  it('flags Italian redundancy ("ripeti di nuovo")', () => {
    const obs = analyzeIt('Analizza il testo e poi ripeti di nuovo la procedura di controllo completa');
    expect(obs.some(o => o.code === 'SYN_101')).toBe(true);
  });
});

// ─── Doppia negazione: solo inglese, per grammatica non per caso ─────────────

describe('double negation gated to English', () => {
  it('does not fire on grammatically-correct Italian double negation', () => {
    const obs = runAllObservations(
      'Controlla il documento perché non voglio mai vedere niente di sbagliato nella versione finale',
      [], undefined, 2.5, makeLangState()
    );
    expect(obs.some(o => o.code === 'GRAM_002')).toBe(false);
  });

  it('still fires on English double negation', () => {
    const state = makeLangState();
    const obs = runAllObservations(
      'Write the report but do not include nothing about the budget section',
      [], undefined, 2.5, state
    );
    expect(state.lastLang).toBe('en');
    expect(obs.some(o => o.code === 'GRAM_002')).toBe(true);
  });
});

// ─── Stato lingua per-istanza ────────────────────────────────────────────────

describe('per-instance language state', () => {
  it('two states do not leak into each other', () => {
    const a = makeLangState();
    const b = makeLangState();
    // Il flusso A diventa italiano…
    runAllObservations('Scrivi una lista di tutte le funzioni del programma per il cliente', [], undefined, 2.5, a);
    expect(a.lastLang).toBe('it');
    // …il flusso B, su testo ambiguo/corto, NON deve ereditare l'italiano di A.
    runAllObservations('Fix bug 123 asap', [], undefined, 2.5, b);
    expect(b.lastLang).toBe('en');
  });

  it('sticky within the same state on ambiguous follow-up text', () => {
    const s = makeLangState();
    runAllObservations('Scrivi una descrizione completa della nuova applicazione per il cliente finale', [], undefined, 2.5, s);
    expect(s.lastLang).toBe('it');
    runAllObservations('ok 123', [], undefined, 2.5, s); // nessun segnale: resta sticky
    expect(s.lastLang).toBe('it');
  });
});

// ─── Ranking dei suggerimenti ────────────────────────────────────────────────

describe('suggestion ranking heuristics', () => {
  it('prefers candidates sharing the first letter at equal edit distance', () => {
    const suggs = getSuggestions('writr', 5, 'en');
    expect(suggs.length).toBeGreaterThan(0);
    expect(suggs[0][0]).toBe('w');
  });
});

// ─── Sanità generale: la suite storica resta il contratto ────────────────────

describe('no regressions on prior fixed classes', () => {
  it('indefinite compounds still pass (something/anything/…)', () => {
    for (const w of ['something', 'anything', 'everything', 'whenever']) {
      expect(isCorrect(w, 'en')).toBe(true);
    }
  });

  it('Italian enclitics still pass (capirlo/aiutami/guardandola)', () => {
    for (const w of ['capirlo', 'aiutami', 'guardandola']) {
      expect(isCorrect(w, 'it')).toBe(true);
    }
  });

  it('expanded dictionary accepts common irregular verb forms', () => {
    for (const w of ['fatto', 'detto', 'visto', 'può', 'vorrei', 'messo', 'scritto']) {
      expect(isCorrect(w, 'it')).toBe(true);
    }
  });

  it('detectLanguage still works both ways', () => {
    expect(detectLanguage('scrivi una lista delle cose più importanti da fare')).toBe('it');
    expect(detectLanguage('write a list of the most important things to do')).toBe('en');
  });
});

// ─── v2.6.0: dizionario italiano quasi completo (bigItalian) ─────────────────

import {
  loadBigItalian, correctItBig, suggestItBig,
  addPersonalWord, removePersonalWord, setPersonalWords, getPersonalWords,
} from '../src/spell/bigItalian.js';

describe('near-complete Italian dictionary', () => {
  beforeAll(async () => { await loadBigItalian(); });

  it('accepts common/medium/rare real words the curated list missed', () => {
    const words = [
      'perché','città','università','coniugazione','miriade','effimero',
      'stoicismo','fotosintesi','biodiversità','malinconico','crepuscolo',
      'tergiversare','pernottamento','disquisizione','usignolo',
    ];
    const missed = words.filter(w => correctItBig(w) !== true);
    expect(missed).toEqual([]);
  });

  it('still flags clear non-words', () => {
    for (const w of ['coniugaziome','effimore','malincomico','tergiverssare','asdfgh']) {
      expect(correctItBig(w)).toBe(false);
    }
  });

  it('suggests the right correction for a real typo', () => {
    expect(suggestItBig('coniugaziome', 3)).toContain('coniugazione');
    expect(suggestItBig('malincomico', 3)).toContain('malinconico');
  });

  it('personal dictionary makes a word always-correct', () => {
    expect(correctItBig('pippozzo')).toBe(false);
    addPersonalWord('pippozzo');
    expect(correctItBig('pippozzo')).toBe(true);
    removePersonalWord('pippozzo');
    expect(correctItBig('pippozzo')).toBe(false);
  });

  it('personal dictionary can be bulk-set and read back for persistence', () => {
    setPersonalWords(['acme', 'wibble', 'Foo']);
    expect(correctItBig('acme')).toBe(true);
    expect(correctItBig('foo')).toBe(true); // normalized lowercase
    expect(getPersonalWords().sort()).toEqual(['acme', 'foo', 'wibble']);
    setPersonalWords([]); // cleanup
  });
});

describe('safe missing-accent auto-fixes', () => {
  it('auto-fixes accent-less forms that are never valid words', () => {
    for (const [bad, good] of [['citta','città'],['universita','università'],['piu','più'],['puo','può'],['cioe','cioè']] as const) {
      const s = getAutocorrectSuggestions(`scrivi ${bad} qui`, undefined, 'it');
      const fix = s.find(x => x.original === bad);
      expect(fix?.corrected).toBe(good);
      expect(fix?.autoApply).toBe(true);
    }
  });

  it('does NOT auto-fix accent-less forms that ARE valid words', () => {
    // "pero" (pear tree), "papa" (pope), "meta" (goal) must be left alone
    for (const w of ['pero','papa','meta']) {
      const s = getAutocorrectSuggestions(`il ${w} qui`, undefined, 'it');
      expect(s.find(x => x.original === w && x.autoApply)).toBeUndefined();
    }
  });
});
