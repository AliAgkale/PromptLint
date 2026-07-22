/**
 * promptlint-core — Contradiction rules
 * Covers: CONTRA_001–003, TMPL_001, AMB_001, REF_001
 */

import type { Observation } from '../types.js';
import { obs, UILocale, CONF } from './shared.js';
import type { PromptModel } from '../slots/model.js';

export function runScopeLengthContradiction(text: string, model: PromptModel, uiLocale: UILocale = 'it'): Observation[] {
  const tight = model.cross.lengthDepth;
  if (tight) {
    return [obs(
      'contradiction', 'contradiction', uiLocale === 'it' ? '🔴 Contraddizione' : '🔴 Contradiction',
      tight.match, tight.index, text,
      uiLocale === 'it'
        ? `La lunghezza richiesta (${tight.match}) è troppo ridotta per la profondità che chiedi. Il modello non può essere esaustivo e rispettare quel limite: ne ignorerà uno.`
        : `The requested length (${tight.match}) is too short for the depth you're asking for. The model can't be exhaustive and respect that limit at the same time: it will ignore one of them.`,
      uiLocale === 'it' ? 'Aumenta la lunghezza, oppure riduci la profondità richiesta.' : 'Increase the length, or reduce the requested depth.',
      { before: tight.match, after: uiLocale === 'it' ? '(lunghezza coerente con la profondità)' : '(length consistent with the depth)' },
      0, 'CONTRA_001', CONF.certain
    )];
  }

  // Direct length antonym across an adversative conjunction ("un testo lungo
  // ma breve", "detailed but short"). Requires the two opposite length words
  // to be joined by ma/però/but/… within a short window, so "un breve
  // riassunto di un lungo documento" (two different objects, no adversative)
  // is NOT flagged. Found via the benchmark: "Scrivi un testo lungo ma breve"
  // scored 87 with no contradiction, because "lungo" alone wasn't a COMPLETE
  // cue and the adversative length clash had no dedicated rule.
  const ADVERS = '(?:ma|però|pero|eppure|tuttavia|but|yet|however)';
  const LONG = '(?:lungh?[oaie]|lunghissim[oa]|estes[oa]|dettagliat[oa]|approfondit[oa]|long|detailed|lengthy)';
  const SHORTW = '(?:brev[ei]|cort[oaie]|concis[oa]|sintetic[oa]|stringat[oa]|short|brief|concise)';
  const longShort = text.match(new RegExp(`\\b${LONG}\\b[^.!?]{0,25}\\b${ADVERS}\\b[^.!?]{0,25}\\b${SHORTW}\\b`, 'i'))
    ?? text.match(new RegExp(`\\b${SHORTW}\\b[^.!?]{0,25}\\b${ADVERS}\\b[^.!?]{0,25}\\b${LONG}\\b`, 'i'));
  if (longShort) {
    return [obs(
      'contradiction', 'contradiction', uiLocale === 'it' ? '🔴 Contraddizione' : '🔴 Contradiction',
      longShort[0], text.indexOf(longShort[0]), text,
      uiLocale === 'it'
        ? `"${longShort[0]}" si contraddice: chiedi qualcosa di lungo e breve allo stesso tempo. Il modello ne ignorerà uno.`
        : `"${longShort[0]}" contradicts itself: you're asking for something long and short at the same time. The model will ignore one.`,
      uiLocale === 'it' ? 'Scegli una lunghezza sola, oppure indicala in modo concreto (es. "circa 300 parole").' : 'Pick a single length, or state it concretely (e.g. "around 300 words").',
      { before: longShort[0], after: uiLocale === 'it' ? '(una lunghezza coerente)' : '(a single coherent length)' },
      0, 'CONTRA_001', CONF.certain
    )];
  }

  const COMPLETE = /\b(completo|completa|esaustiv[oa]|esaurient[ei]|dettagliat[oa]|approfondit[oa]|dettagliatamente|molto lungo|estremamente|approfondisci|nei minimi dettagli|comprehensive|exhaustive|detailed|thorough|in-depth|in depth|extensive|elaborate)\b/i;
  const SHORT = /\b(in una frase|in 1 frase|in una riga|in 1 riga|una sola parola|in una parola|1 parola|massimo\s+([1-9]|[12]\d|30)\s+parole|max\s+([1-9]|[12]\d|30)\s+parole|in ([1-9]|1\d|20)\s+parole|molto breve|breve|brevemente|concis[oa]|in poche parole|una sola frase|in sintesi|one sentence|in \d\d? words|very short|briefly|in a word|single word)\b/i;
  const cm = text.match(COMPLETE);
  const sm = text.match(SHORT);
  if (!cm || !sm) return [];
  return [obs(
    'contradiction', 'contradiction', uiLocale === 'it' ? '🔴 Contraddizione' : '🔴 Contradiction',
    cm[0] + ' … ' + sm[0], text.indexOf(cm[0]), text,
    uiLocale === 'it'
      ? `"${cm[0]}" e "${sm[0]}" si contraddicono: chiedi qualcosa di esaustivo e allo stesso tempo molto breve. Il modello non può soddisfare entrambi e ne ignorerà uno.`
      : `"${cm[0]}" and "${sm[0]}" contradict each other: you're asking for something exhaustive and very short at the same time. The model can't satisfy both and will ignore one.`,
    uiLocale === 'it'
      ? 'Scegli una delle due: o completo, o breve. Oppure specifica la lunghezza adeguata alla profondità richiesta.'
      : 'Pick one: either comprehensive, or short. Or specify a length that matches the requested depth.',
    { before: cm[0] + ' … ' + sm[0], after: uiLocale === 'it' ? '(coerenza tra profondità e lunghezza)' : '(consistency between depth and length)' },
    0, 'CONTRA_001', CONF.certain
  )];
}

/** CONTRA_002 — Conflicting instructions beyond scope/length. Real prompts
 *  often carry two instructions that can't both hold: "formale ma con emoji",
 *  "tecnico ma per bambini", "in inglese e in italiano". Each conflict is a
 *  pair of mutually-exclusive style/format/audience demands the model can't
 *  satisfy at once. This is the most useful deterministically-detectable
 *  problem class after scope/length — it catches the prompt that looks
 *  complete but quietly contradicts itself. Kept to high-precision pairs
 *  (both sides must be explicitly present) to avoid false positives. */
const CONFLICT_PAIRS: Array<{ a: RegExp; b: RegExp; why: string; sameSentence?: boolean }> = [
  // NOTE: the former formal-vs-informal pair here was replaced by the TONE
  // slot (src/slots/tone.ts), which normalizes tone cues to canonical values
  // and checks a compatibility matrix — catching synonymic conflicts
  // ("dettagliato ma stringato", "easy-going ma rigoroso") the flat regex
  // missed, while correctly allowing composite registers (professional+warm).
  // See runConflictingInstructions, which now calls the slot first.
  // NOTE: the former technical-vs-child pair was replaced by the AUDIENCE slot
  // (src/slots/audience.ts), which separates reader LEVEL from writing tone and
  // detects audience↔tone conflicts (expert reader + simple tone, beginner
  // reader + technical tone) plus internal reader conflicts.
  // Language pair is gated to the SAME sentence. A real "write it in English
  // and in Italian" contradiction is stated together in one clause; two
  // language mentions in DIFFERENT sentences almost always play different
  // roles — e.g. authoring a system prompt whose internal rule is "rispondi in
  // italiano" while the deliverable itself must be "in inglese". Flagging that
  // cross-sentence pair as a contradiction was a real false positive (a fully
  // specified prompt scored 58/fair because of it).
  { a: /\b(in inglese|in english|traduci in inglese)\b/i,
    b: /\b(in italiano|in francese|in spagnolo|in tedesco|in italian)\b/i,
    why: 'due lingue di output diverse', sameSentence: true },
  { a: /\b(creativ[oa]|fantasios[oa]|originale|libero|creative|imaginative)\b/i,
    b: /\b(attieniti (strettamente|esattamente)|segui alla lettera|senza (deviare|inventare)|rigorosamente|strictly follow|do not deviate)\b/i,
    why: 'libertà creativa e aderenza rigida' },
  // NOTE: the former list-vs-prose pair here was replaced by the FORMAT slot.
  { a: /\b(solo (i )?fatti|oggettiv[oa]|senza opinioni|neutrale|just the facts|objective)\b/i,
    b: /\b(dai (la )?tua opinione|cosa ne pensi|opinione personale|your opinion|what do you think)\b/i,
    why: 'solo fatti e opinione personale' },
  // Neutralità + verdetto assoluto: "sii obiettivo e neutrale" + "dimmi qual
  // è senza dubbio il migliore" è un conflitto semantico indipendente dal
  // dominio — chiedere neutralità e contemporaneamente un verdetto definitivo
  // si escludono a vicenda anche senza sapere nulla dell'argomento in questione
  // (found via adversarial testing: "Sii completamente oggettivo... dimmi
  // qual è senza dubbio il miglior partito" scored 74 with no contradiction
  // detected). The same pattern covers "dimmi oggettivamente il prodotto
  // migliore", "analisi neutrale e poi dimmi certamente X" etc.
  { a: /\b(obiettiv[oa]|neutrale|imparziale|senza pregiudizi|bilanciato|unbiased|neutral|impartial|balanced)\b/i,
    b: /\b(senza dubbio|indubbiamente|certamente|sicuramente il (migliore?|peggiore?|più)|definitivamente|è chiaramente|without (a )?doubt|definitely the best|clearly the best|objectively the best)\b/i,
    why: 'neutralità richiesta e verdetto assoluto incompatibili' },
];

/** TMPL_001 — the prompt is an UNFILLED template/skeleton: placeholder
 *  variables ({{topic}}, <NOME>), bracket placeholders ([INSERISCI QUI], [YOUR
 *  TEXT]), classic "lorem ipsum" filler, or a label-only skeleton where every
 *  line is a bare "Label:" with nothing after it. The model has nothing to act
 *  on. Found via the 250-prompt benchmark: "[INSERISCI QUI IL TESTO]" scored 68
 *  and "Titolo:\nDescrizione:\n…" scored 50. A FILLED label block ("Contesto:
 *  azienda B2B\nTask: scrivi…") is well-structured and must NOT trigger. */
export function runUnfilledTemplate(text: string, uiLocale: UILocale = 'it'): Observation[] {
  const markers: RegExp[] = [
    /\{\{\s*[\w .\-]+\s*\}\}/,
    /\[\s*(inseris\w*|insert|your|il\s+tuo|la\s+tua|testo\s+qui|text\s+here|todo|placeholder|x{3,}|nome|name|argomento|topic)\b[^\]]*\]/i,
    /<\s*[A-ZÀ-Ö_]{3,}\s*>/,
    /\blorem\s+ipsum\b/i,
  ];
  let hit: { text: string; index: number } | null = null;
  for (const re of markers) {
    const m = text.match(re);
    if (m && m.index != null) { hit = { text: m[0], index: m.index }; break; }
  }
  if (!hit) {
    // Label-only skeleton: every non-empty line is a bare "Label:" (nothing after).
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const bareLabel = /^[\wàèéìòùáéíóú' /()-]{1,30}:$/i;
    if (lines.length >= 2 && lines.every((l) => bareLabel.test(l))) {
      hit = { text: lines[0], index: 0 };
    }
  }
  if (!hit) return [];
  return [obs(
    'ambiguity', 'contradiction',
    uiLocale === 'it' ? '🔴 Template non compilato' : '🔴 Unfilled template',
    hit.text, hit.index, text,
    uiLocale === 'it'
      ? 'Il prompt contiene segnaposto non compilati (variabili, campi vuoti o testo di riempimento). Il modello non ha nulla di concreto su cui lavorare.'
      : 'The prompt contains unfilled placeholders (template variables, empty fields, or filler text). The model has nothing concrete to work with.',
    uiLocale === 'it'
      ? 'Sostituisci i segnaposto con il contenuto reale prima di inviare.'
      : 'Replace the placeholders with real content before sending.',
    null, 0, 'TMPL_001', CONF.certain
  )];
}

/** CONTRA_002b — "Translate to X but leave/keep it in Y" (Y ≠ X). The generic
 *  language CONFLICT_PAIR above is English-anchored (side `a` requires English),
 *  so a French↔Italian clash like "Traduci in francese ma lascialo in italiano"
 *  was invisible — it scored 93. This detects a translate directive to one
 *  language followed, across an adversative, by a "keep/leave it in" a DIFFERENT
 *  language. Source→target phrasings ("dall'inglese all'italiano") don't match
 *  because they lack the adversative + keep-verb structure. */
const LANG_CANON: Record<string, string> = {
  inglese: 'en', english: 'en', italiano: 'it', italian: 'it',
  francese: 'fr', french: 'fr', spagnolo: 'es', spanish: 'es',
  tedesco: 'de', german: 'de', portoghese: 'pt', portuguese: 'pt',
};
export function runTranslateKeepContradiction(text: string, uiLocale: UILocale = 'it'): Observation[] {
  const LANG = '(inglese|italiano|francese|spagnolo|tedesco|portoghese|english|italian|french|spanish|german|portuguese)';
  const KEEP = '(?:lascia\\w*|lasciarl[oa]|mantien\\w*|mantenerl[oa]|tien\\w*|tenerl[oa]|tienil[oa]|resta\\w*|rest[ai]|rimang[ao]\\w*|keep\\w*|leav\\w*)';
  const ADVERS = '(?:ma|però|pero|eppure|tuttavia|but|yet|however)';
  const re = new RegExp(
    `\\b(?:traduc\\w+|translate)\\b[^.!?]*?\\bin\\s+${LANG}\\b[^.!?]*?\\b${ADVERS}\\b[^.!?]*?\\b${KEEP}\\b[^.!?]*?\\bin\\s+${LANG}\\b`,
    'i',
  );
  const m = text.match(re);
  if (!m) return [];
  const a = LANG_CANON[m[1].toLowerCase()] ?? m[1].toLowerCase();
  const b = LANG_CANON[m[2].toLowerCase()] ?? m[2].toLowerCase();
  if (a === b) return []; // "traduci in inglese ma tienilo in english" — same language, not a clash
  return [obs(
    'contradiction', 'contradiction', uiLocale === 'it' ? '🔴 Istruzioni in conflitto' : '🔴 Conflicting instructions',
    m[0], text.indexOf(m[0]), text,
    uiLocale === 'it'
      ? `Chiedi di tradurre in ${m[1]} ma poi di lasciarlo in ${m[2]}: sono due lingue di output diverse. Il modello non può fare entrambe e ne sceglierà una.`
      : `You ask to translate into ${m[1]} but then to keep it in ${m[2]}: those are two different output languages. The model can't do both and will pick one.`,
    uiLocale === 'it' ? 'Indica una sola lingua di destinazione.' : 'State a single target language.',
    { before: m[0], after: uiLocale === 'it' ? '(una sola lingua di output)' : '(a single output language)' },
    0, 'CONTRA_002', CONF.certain
  )];
}

export function runConflictingInstructions(text: string, model: PromptModel, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  const CONFLICT_LABEL = uiLocale === 'it' ? '🔴 Istruzioni in conflitto' : '🔴 Conflicting instructions';

  // TONE slot (read from the pre-built model). Normalized tone conflicts:
  // synonymic contradictions are caught and legitimate composite registers
  // are not.
  const tone = model.tone;
  for (const c of tone.conflicts) {
    const lo = Math.min(c.a.index, c.b.index);
    results.push(obs(
      'contradiction', 'contradiction', CONFLICT_LABEL,
      `${c.a.match} … ${c.b.match}`, lo, text,
      uiLocale === 'it'
        ? `Il prompt chiede due registri incompatibili (${c.why}): "${c.a.match}" e "${c.b.match}". Il modello non può soddisfarli entrambi e ne sceglierà uno a caso.`
        : `The prompt asks for two incompatible registers (${c.why}): "${c.a.match}" and "${c.b.match}". The model can't satisfy both and will pick one at random.`,
      uiLocale === 'it' ? 'Tieni una sola direzione di tono, oppure chiarisci come combinarle.' : 'Keep a single tone direction, or clarify how to combine them.',
      { before: `${c.a.match} … ${c.b.match}`, after: uiLocale === 'it' ? '(scegli un registro coerente)' : '(pick a consistent register)' },
      0, 'CONTRA_002', CONF.certain
    ));
  }

  // FORMAT slot (read from model). Internal conflicts (list↔prose, json↔table)
  // and cross-slot with TONE (data format + narrative voice).
  const format = model.format;
  for (const c of format.conflicts) {
    const lo = Math.min(c.a.index, c.b.index);
    results.push(obs(
      'contradiction', 'contradiction', CONFLICT_LABEL,
      `${c.a.match} … ${c.b.match}`, lo, text,
      uiLocale === 'it'
        ? `Il prompt chiede due formati di output incompatibili (${c.why}): "${c.a.match}" e "${c.b.match}". Il modello non può produrli entrambi come forma della stessa risposta.`
        : `The prompt asks for two incompatible output formats (${c.why}): "${c.a.match}" and "${c.b.match}". The model can't produce both as the shape of a single answer.`,
      uiLocale === 'it' ? 'Scegli un solo formato di output.' : 'Pick a single output format.',
      { before: `${c.a.match} … ${c.b.match}`, after: uiLocale === 'it' ? '(un solo formato)' : '(a single format)' },
      0, 'CONTRA_002', CONF.certain
    ));
  }
  const ftConflict = model.cross.formatTone;
  if (ftConflict) {
    const voice = tone.tones.find((t) => t.tone === 'creative' || t.tone === 'warm' || t.tone === 'enthusiastic')!;
    results.push(obs(
      'contradiction', 'contradiction', CONFLICT_LABEL,
      `${ftConflict.match} … ${voice.match}`, Math.min(ftConflict.index, voice.index), text,
      uiLocale === 'it'
        ? `Un formato dati strutturato ("${ftConflict.match}") non può avere un tono ${voice.match}: i formati come JSON, CSV o tabella non hanno spazio per una voce narrativa. Il modello ne ignorerà uno.`
        : `A structured data format ("${ftConflict.match}") can't have a ${voice.match} tone: formats like JSON, CSV or tables leave no room for a narrative voice. The model will ignore one.`,
      uiLocale === 'it' ? 'Scegli: o un formato dati strutturato, o un testo con voce narrativa.' : 'Choose: either a structured data format, or a narrative-voice text.',
      { before: `${ftConflict.match} … ${voice.match}`, after: uiLocale === 'it' ? '(formato dati OPPURE voce narrativa)' : '(data format OR narrative voice)' },
      0, 'CONTRA_002', CONF.certain
    ));
  }

  // AUDIENCE slot (read from model). Internal reader conflicts and cross-slot
  // with TONE, with dedup so the simple↔technical depth axis (detectable via
  // TONE, audience-internal, and audience×tone) is reported only once.
  const audience = model.audience;
  const atConflict = model.cross.audienceTone;
  const depthFamilyAlreadyReported =
    tone.conflicts.some(
      (c) =>
        (c.a.tone === 'simple' && c.b.tone === 'technical') ||
        (c.a.tone === 'technical' && c.b.tone === 'simple'),
    );

  if (atConflict && !depthFamilyAlreadyReported) {
    results.push(obs(
      'contradiction', 'contradiction', CONFLICT_LABEL,
      `${atConflict.audienceMatch} … ${atConflict.toneMatch}`,
      Math.min(text.indexOf(atConflict.audienceMatch), text.indexOf(atConflict.toneMatch)), text,
      uiLocale === 'it'
        ? `Il prompt chiede due cose incompatibili (${atConflict.why}): il livello del pubblico e il tono richiesto si contraddicono. Il modello ne ignorerà uno.`
        : `The prompt asks for two incompatible things (${atConflict.why}): the audience level and the requested tone contradict each other. The model will ignore one.`,
      uiLocale === 'it'
        ? 'Allinea il tono al pubblico: un pubblico esperto vuole un taglio tecnico, un principiante uno semplice.'
        : 'Align the tone with the audience: an expert audience wants a technical angle, a beginner wants a simple one.',
      { before: `${atConflict.audienceMatch} … ${atConflict.toneMatch}`, after: uiLocale === 'it' ? '(tono coerente col pubblico)' : '(tone consistent with the audience)' },
      0, 'CONTRA_002', CONF.certain
    ));
  } else if (audience.internalConflict && !depthFamilyAlreadyReported && !atConflict) {
    const { a: aa, b: ab } = audience.internalConflict;
    results.push(obs(
      'contradiction', 'contradiction', CONFLICT_LABEL,
      `${aa.match} … ${ab.match}`, Math.min(aa.index, ab.index), text,
      uiLocale === 'it'
        ? `Il prompt indica due pubblici incompatibili: "${aa.match}" e "${ab.match}". Il modello non può rivolgersi a entrambi con lo stesso taglio.`
        : `The prompt states two incompatible audiences: "${aa.match}" and "${ab.match}". The model can't address both with the same angle.`,
      uiLocale === 'it' ? 'Scegli un solo pubblico di riferimento.' : 'Pick a single target audience.',
      { before: `${aa.match} … ${ab.match}`, after: uiLocale === 'it' ? '(un solo pubblico)' : '(a single audience)' },
      0, 'CONTRA_002', CONF.certain
    ));
  }

  for (const pair of CONFLICT_PAIRS) {
    const ma = text.match(pair.a);
    const mb = text.match(pair.b);
    if (ma && mb) {
      if (pair.sameSentence) {
        const lo = Math.min(text.indexOf(ma[0]), text.indexOf(mb[0]));
        const hi = Math.max(text.indexOf(ma[0]) + ma[0].length, text.indexOf(mb[0]) + mb[0].length);
        if (/[.!?\n]/.test(text.slice(lo, hi))) continue;
      }
      results.push(obs(
        'contradiction', 'contradiction', CONFLICT_LABEL,
        `${ma[0]} … ${mb[0]}`, Math.min(text.indexOf(ma[0]), text.indexOf(mb[0])), text,
        uiLocale === 'it'
          ? `Il prompt chiede due cose incompatibili (${pair.why}): "${ma[0]}" e "${mb[0]}". Il modello non può soddisfarle entrambe e ne sceglierà una a caso.`
          : `The prompt asks for two incompatible things (${pair.why}): "${ma[0]}" and "${mb[0]}". The model can't satisfy both and will pick one at random.`,
        uiLocale === 'it'
          ? 'Tieni una sola delle due istruzioni in conflitto, oppure chiarisci come combinarle.'
          : 'Keep only one of the two conflicting instructions, or clarify how to combine them.',
        { before: `${ma[0]} … ${mb[0]}`, after: uiLocale === 'it' ? '(scegli una direzione coerente)' : '(pick a consistent direction)' },
        0, 'CONTRA_002', CONF.certain
      ));
    }
  }

  // CONTRA_003 — same action affirmed AND negated ("includi esempi ma non
  // usare esempi", "add comments but don't add comments"). High precision:
  // requires the SAME content word to appear once governed by an affirmative
  // verb and once by a negation, so it only fires on genuine self-cancellation.
  const NEG = /\b(non|senza|no|niente|nessun[oa]?|evita\w*|don'?t|do not|without|avoid|never)\b/i;
  // content words that commonly get both affirmed and forbidden in one prompt
  const CONTENT = ['esempi?', 'commenti?', 'emoji', 'codice', 'spiegazion\\w*', 'dettagl\\w*', 'introduzion\\w*', 'premess\\w*', 'examples?', 'comments?', 'code', 'details?', 'explanations?'];
  for (const c of CONTENT) {
    const re = new RegExp(c, 'gi');
    const occ = [...text.matchAll(re)];
    if (occ.length < 2) continue;
    // Is at least one occurrence negated and at least one NOT negated?
    let negated = 0, affirmed = 0;
    for (const o of occ) {
      const before = text.slice(Math.max(0, o.index! - 25), o.index!);
      if (NEG.test(before)) negated++; else affirmed++;
    }
    if (negated > 0 && affirmed > 0) {
      // v2.23: if the content word appears WAY more often affirmed than
      // negated, it's the prompt's THEME, not a self-cancellation.
      // "code review... Never approve code with security issues" — "code"
      // appears many times because it IS the topic; the "never approve"
      // clause is a specific safety rule, not a general prohibition on the
      // topic. Found via false-reject on q0539.
      // Threshold: affirmed count must be at least 2x negated count AND
      // at least 3 affirmed occurrences (below 3 the ratio is too noisy).
      if (affirmed >= 3 && affirmed >= negated * 2) continue;
      const word = occ[0]![0];
      results.push(obs(
        'contradiction', 'contradiction', uiLocale === 'it' ? '🔴 Azione richiesta e negata' : '🔴 Action requested and forbidden',
        word, occ[0]!.index!, text,
        uiLocale === 'it'
          ? `Il prompt chiede e insieme vieta la stessa cosa ("${word}"): compare sia come richiesta sia con una negazione. Il modello riceve due ordini opposti sullo stesso elemento e ne ignorerà uno.`
          : `The prompt both requests and forbids the same thing ("${word}"): it appears both as a request and with a negation. The model gets two opposite orders about the same element and will ignore one.`,
        uiLocale === 'it'
          ? 'Decidi se vuoi quell\'elemento oppure no, e lascia una sola istruzione.'
          : 'Decide whether you want that element or not, and leave only one instruction.',
        { before: uiLocale === 'it' ? `includi ${word} … non usare ${word}` : `include ${word} … don't use ${word}`,
          after: uiLocale === 'it' ? `(scegli: includere o non includere ${word})` : `(choose: include or exclude ${word})` },
        0, 'CONTRA_003', CONF.certain
      ));
      break; // one self-cancellation is enough to flag
    }
  }
  return results;
}


