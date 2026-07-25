/**
 * promptlint-core — Prompt scaffold
 *
 * Turns "what is missing" into "here is the shape it should have".
 *
 * The analyzer already knows the intent and which specification slots are
 * present. Telling a user their prompt lacks a format is a diagnosis; handing
 * them a fill-in-the-blank line with the parts they already wrote kept in
 * place is a fix. This module does the second thing.
 *
 * ── Why this is not generation ───────────────────────────────────────────
 *
 * Nothing here writes content. The subject of the request is lifted verbatim
 * from what the user typed; everything added is a labelled blank with a short
 * list of typical values for that intent. The user picks or types.
 *
 * That is a deliberate choice, not only a constraint of running offline. A
 * model asked to "improve this prompt" invents the missing requirements — it
 * decides the article is 800 words for a non-technical audience, and the user
 * accepts without noticing a decision was made. A blank forces the decision to
 * be the user's, which is the thing worth teaching.
 *
 * Slot vocabularies are curated per intent. They are suggestions, never
 * defaults: nothing is pre-selected, and a scaffold with every blank left
 * empty is still a valid, unmodified prompt.
 */

import type { PromptIntent, PromptStructure } from '../types.js';

export type SlotId =
  | 'artifact' | 'length' | 'audience' | 'tone' | 'structure'
  | 'language' | 'constraints' | 'errors' | 'tests'
  | 'depth' | 'examples' | 'focus' | 'criteria' | 'count'
  | 'source' | 'target' | 'fields' | 'schema' | 'categories';

export interface ScaffoldSlot {
  id: SlotId;
  /** Short label shown next to the blank. */
  label: string;
  /** True when the prompt already covers this. */
  filled: boolean;
  /** Typical values for this slot under this intent. Never pre-selected. */
  options: string[];
  /** One line explaining what changes if the user fills it. */
  why: string;
}

export interface PromptScaffold {
  intent: PromptIntent;
  /** The user's own subject, lifted verbatim. Empty when none was found. */
  subject: string;
  /** Slots in the order they should be offered — most valuable first. */
  slots: ScaffoldSlot[];
  /**
   * A ready-to-edit line with the filled parts kept and the missing ones as
   * `[label]` blanks. Empty when the prompt is already fully specified.
   */
  template: string;
  /** How many of the offered slots the prompt already covers. */
  filledCount: number;
  totalCount: number;
}

type Locale = 'it' | 'en';

interface SlotSpec {
  id: SlotId;
  label: { it: string; en: string };
  why: { it: string; en: string };
  options: { it: string[]; en: string[] };
  /** Reads the analyzer's structure flags to decide if it is already covered. */
  isFilled: (s: PromptStructure, text: string) => boolean;
}

// ── Slot vocabulary ────────────────────────────────────────────────────────
//
// Values are the ones that actually appear in well-rated prompts for that
// intent, kept short enough to read in a dropdown.

/** Nouns that name the thing to produce. */
const ARTEFACT_NOUN = /\b(articolo|artic[oi]l\w*|email|mail|post|descrizione|elenco|lista|script|saggio|essay|report|relazione|lettera|letter|storia|story|racconto|poesia|poem|slide|presentazione|presentation|riassunto|summary|guida|guide|tutorial|recensione|review|annuncio|caption|titolo|headline|newsletter|comunicato|press release|cv|curriculum|biografia|bio|article|blog post|thread|tweet|landing|copy)\b/i;

const RE_COUNT = /\b\d+\s+(?:\w+\s+)?(parole|words|caratteri|characters|righe|lines|frasi|sentences|punti|points|paragrafi|paragraphs|slide|idee|ideas|esempi|examples|opzioni|options|domande|questions)\b/i;

const SLOTS: Record<SlotId, SlotSpec> = {
  artifact: {
    id: 'artifact',
    label: { it: 'cosa produrre', en: 'what to produce' },
    why: { it: 'Senza il tipo di testo il modello sceglie da sé fra articolo, email e post.',
           en: 'Without the artefact type the model picks between an article, an email and a post on its own.' },
    options: { it: ['un articolo', 'un\'email', 'un post', 'una descrizione', 'un elenco puntato', 'uno script'],
               en: ['an article', 'an email', 'a post', 'a description', 'a bullet list', 'a script'] },
    // `structure.format` means an OUTPUT FORMAT (JSON, markdown, table) — a
    // different thing from naming the artefact. "Scrivi un articolo" names the
    // artefact and sets no format, and asking "what should I produce?" there
    // would be absurd.
    isFilled: (_s, t) => ARTEFACT_NOUN.test(t),
  },
  length: {
    id: 'length',
    label: { it: 'lunghezza', en: 'length' },
    why: { it: 'È il vincolo che cambia di più il risultato: senza, la risposta tende al lungo.',
           en: 'The constraint that changes the output most: without it, answers run long.' },
    options: { it: ['100 parole', '300 parole', '800 parole', '3 frasi', '5 punti'],
               en: ['100 words', '300 words', '800 words', '3 sentences', '5 bullets'] },
    isFilled: (s, t) => s.length || RE_COUNT.test(t),
  },
  audience: {
    id: 'audience',
    label: { it: 'per chi', en: 'for whom' },
    why: { it: 'Il destinatario decide il lessico e quanto va spiegato.',
           en: 'The audience decides the vocabulary and how much gets explained.' },
    options: { it: ['un pubblico non tecnico', 'principianti', 'esperti del settore', 'un CEO', 'clienti'],
               en: ['a non-technical audience', 'beginners', 'domain experts', 'a CEO', 'customers'] },
    isFilled: (s) => s.constraints,
  },
  tone: {
    id: 'tone',
    label: { it: 'tono', en: 'tone' },
    why: { it: 'Senza indicazione il registro sarà neutro, spesso più formale del voluto.',
           en: 'With nothing stated the register lands neutral, usually more formal than intended.' },
    options: { it: ['professionale', 'informale', 'diretto', 'divulgativo', 'persuasivo'],
               en: ['professional', 'informal', 'direct', 'plain-language', 'persuasive'] },
    isFilled: (s, t) => /\b(tono|tone|stile|style|formale|informale|professionale|friendly|casual)\b/i.test(t),
  },
  structure: {
    id: 'structure',
    label: { it: 'struttura', en: 'structure' },
    why: { it: 'Dare le sezioni evita che il modello inventi un ordine suo.',
           en: 'Naming the sections stops the model inventing its own order.' },
    options: { it: ['introduzione, 3 sezioni, conclusione', 'problema → soluzione → esempio', 'elenco puntato', 'domanda e risposta'],
               en: ['intro, 3 sections, conclusion', 'problem → solution → example', 'bullet points', 'Q&A'] },
    isFilled: (s, t) => /\b(sezion\w*|struttur\w*|paragraf\w*|introduzione|conclusione|section|structure|intro|conclusion|outline)\b/i.test(t),
  },
  language: {
    id: 'language',
    label: { it: 'linguaggio', en: 'language' },
    why: { it: 'Senza il linguaggio il modello sceglie il più diffuso, che spesso non è il tuo.',
           en: 'Unstated, the model picks the most common language, which is often not yours.' },
    options: { it: ['Python', 'JavaScript', 'TypeScript', 'Java', 'SQL', 'Go'],
               en: ['Python', 'JavaScript', 'TypeScript', 'Java', 'SQL', 'Go'] },
    isFilled: (_s, t) => /\b(python|javascript|typescript|java|c\+\+|c#|go|rust|php|ruby|swift|kotlin|sql|bash|html|css|react|vue)\b/i.test(t),
  },
  constraints: {
    id: 'constraints',
    label: { it: 'vincoli', en: 'constraints' },
    why: { it: 'Dire cosa NON usare è spesso più efficace che dire cosa usare.',
           en: 'Saying what not to use is often more effective than saying what to use.' },
    options: { it: ['senza librerie esterne', 'compatibile con Node 18', 'solo standard library', 'massimo 50 righe'],
               en: ['no external libraries', 'Node 18 compatible', 'standard library only', 'under 50 lines'] },
    isFilled: (s) => s.constraints,
  },
  errors: {
    id: 'errors',
    label: { it: 'gestione errori', en: 'error handling' },
    why: { it: 'Se non lo chiedi, il codice generato assume che vada sempre tutto bene.',
           en: 'Unasked, generated code assumes nothing ever fails.' },
    options: { it: ['con gestione degli errori', 'con validazione degli input', 'senza, versione minima'],
               en: ['with error handling', 'with input validation', 'none, minimal version'] },
    isFilled: (_s, t) => /\b(error|errori|exception|eccezion\w*|try\s*\/?\s*catch|validaz\w*|validation|edge case)\b/i.test(t),
  },
  tests: {
    id: 'tests',
    label: { it: 'test', en: 'tests' },
    why: { it: 'Chiedere i test insieme al codice costa poco e cambia la qualità.',
           en: 'Asking for tests alongside the code is cheap and changes the quality.' },
    options: { it: ['con test unitari', 'con un esempio d\'uso', 'senza test'],
               en: ['with unit tests', 'with a usage example', 'no tests'] },
    isFilled: (_s, t) => /\b(test|unit test|jest|vitest|pytest|esempio d'uso|usage example)\b/i.test(t),
  },
  depth: {
    id: 'depth',
    label: { it: 'livello', en: 'depth' },
    why: { it: 'Senza livello la spiegazione parte da zero anche se non serve.',
           en: 'With no level set the explanation starts from scratch whether you need it or not.' },
    options: { it: ['spiegazione semplice', 'livello intermedio', 'in dettaglio tecnico', 'con la matematica'],
               en: ['simple explanation', 'intermediate', 'technical detail', 'including the maths'] },
    isFilled: (_s, t) => /\b(semplice|simple|base|basic|avanzat\w*|advanced|tecnic\w*|technical|in profondit[àa]|in depth|dettagli\w*|detail)\b/i.test(t),
  },
  examples: {
    id: 'examples',
    label: { it: 'esempi', en: 'examples' },
    why: { it: 'Un esempio concreto è la differenza fra una definizione e qualcosa di usabile.',
           en: 'A concrete example is the difference between a definition and something usable.' },
    options: { it: ['con 2 esempi concreti', 'con un caso reale', 'con un\'analogia', 'senza esempi'],
               en: ['with 2 concrete examples', 'with a real case', 'with an analogy', 'no examples'] },
    isFilled: (s) => s.examples,
  },
  focus: {
    id: 'focus',
    label: { it: 'su cosa concentrarsi', en: 'what to focus on' },
    why: { it: 'Senza un fuoco il riassunto tiene tutto e taglia a caso.',
           en: 'With no focus a summary keeps everything and cuts at random.' },
    options: { it: ['le decisioni prese', 'i dati numerici', 'le azioni da fare', 'gli argomenti principali'],
               en: ['the decisions taken', 'the numbers', 'the action items', 'the main arguments'] },
    isFilled: (_s, t) => /\b(concentr\w*|focus|solo su|only on|in particolare|specifically|evidenzia|highlight)\b/i.test(t),
  },
  criteria: {
    id: 'criteria',
    label: { it: 'criteri', en: 'criteria' },
    why: { it: 'Dare i criteri trasforma un elenco generico in idee utilizzabili.',
           en: 'Criteria turn a generic list into ideas you can act on.' },
    options: { it: ['realizzabili in una settimana', 'a costo zero', 'originali, non ovvie', 'adatte a un piccolo team'],
               en: ['doable in a week', 'zero budget', 'original, not obvious', 'suited to a small team'] },
    isFilled: (s) => s.constraints,
  },
  count: {
    id: 'count',
    label: { it: 'quante', en: 'how many' },
    why: { it: 'Un numero preciso evita sia le tre idee scarne sia le venti diluite.',
           en: 'A number avoids both the thin three and the diluted twenty.' },
    options: { it: ['5', '10', '20'], en: ['5', '10', '20'] },
    isFilled: (s, t) => s.length || RE_COUNT.test(t),
  },
  source: {
    id: 'source',
    label: { it: 'il materiale', en: 'the material' },
    why: { it: 'Il modello non vede allegati, link o schermate: il testo va incollato qui.',
           en: 'The model cannot see attachments, links or screenshots — paste the text here.' },
    options: { it: ['(incolla qui il testo)'], en: ['(paste the text here)'] },
    isFilled: (s) => s.examples || s.context,
  },
  target: {
    id: 'target',
    label: { it: 'lingua di arrivo', en: 'target language' },
    why: { it: 'Senza la lingua di arrivo la traduzione è una scommessa.',
           en: 'Without a target language the translation is a guess.' },
    options: { it: ['in inglese', 'in italiano', 'in spagnolo', 'in francese', 'in tedesco'],
               en: ['into English', 'into Italian', 'into Spanish', 'into French', 'into German'] },
    isFilled: (_s, t) => /\b(in\s+(inglese|italiano|spagnolo|francese|tedesco|portoghese|cinese)|into\s+(english|italian|spanish|french|german))\b/i.test(t),
  },
  fields: {
    id: 'fields',
    label: { it: 'quali campi', en: 'which fields' },
    why: { it: 'Elencare i campi evita che il modello decida da sé cosa è rilevante.',
           en: 'Listing the fields stops the model deciding what counts as relevant.' },
    options: { it: ['nome, data, importo', 'tutte le entità nominate', 'solo i numeri'],
               en: ['name, date, amount', 'all named entities', 'numbers only'] },
    isFilled: (s) => s.format,
  },
  schema: {
    id: 'schema',
    label: { it: 'schema', en: 'schema' },
    why: { it: 'Dare le chiavi attese rende l\'output parsabile al primo colpo.',
           en: 'Giving the expected keys makes the output parseable first time.' },
    options: { it: ['{ "titolo": "", "data": "", "valore": 0 }', 'una riga per record', 'array di oggetti'],
               en: ['{ "title": "", "date": "", "value": 0 }', 'one row per record', 'array of objects'] },
    isFilled: (s) => s.examples || s.format,
  },
  categories: {
    id: 'categories',
    label: { it: 'categorie', en: 'categories' },
    why: { it: 'Senza le categorie ammesse il modello se le inventa e non sono stabili.',
           en: 'Without an allowed set the model invents categories, and they are not stable.' },
    options: { it: ['positivo / neutro / negativo', 'urgente / normale / rimandabile', '(elenca le tue)'],
               en: ['positive / neutral / negative', 'urgent / normal / can wait', '(list your own)'] },
    isFilled: (s) => s.examples || s.constraints,
  },
};

// ── Which slots matter, per intent, most valuable first ────────────────────

const BY_INTENT: Partial<Record<PromptIntent, SlotId[]>> = {
  write:         ['artifact', 'length', 'audience', 'tone', 'structure'],
  generate_code: ['language', 'constraints', 'errors', 'tests'],
  explain:       ['depth', 'audience', 'examples', 'length'],
  summarize:     ['source', 'length', 'focus'],
  translate:     ['source', 'target', 'tone'],
  analyze:       ['source', 'focus', 'artifact', 'depth'],
  brainstorm:    ['count', 'criteria', 'audience'],
  classify:      ['source', 'categories', 'schema'],
  extract:       ['source', 'fields', 'schema'],
  convert:       ['source', 'schema', 'constraints'],
  table:         ['source', 'fields', 'length'],
  json:          ['source', 'schema'],
  question:      ['depth', 'length', 'examples'],
  other:         ['artifact', 'length', 'audience'],
};

// ── Subject extraction ─────────────────────────────────────────────────────

const LEADING_VERB = /^\s*\W*(scrivimi|scrivi|creami|crea|generami|genera|fammi|fai|dammi|preparami|prepara|redigi|componi|traducimi|traduci|riassumimi|riassumi|analizzami|analizza|spiegami|spiega|descrivimi|descrivi|elenca|estrai|converti|classifica|write|create|generate|make|give me|draft|prepare|compose|translate|summarise|summarize|analyse|analyze|explain|describe|list|extract|convert|classify)\b\s*/i;
const FILLER_HEAD = /^\s*(per favore|perfavore|potresti|puoi|gentilmente|ti chiedo|vorrei|voglio|mi serve|ho bisogno di|please|could you|can you|kindly|i want|i need|i'?d like)\b[\s,]*/i;

/**
 * Lift the subject out of the prompt: strip courtesy, the leading verb, and
 * any article, and keep what the user was actually asking about. Returns an
 * empty string when nothing recognisable is left — a prompt like "fammi
 * qualcosa" has no subject to preserve.
 */
export function extractSubject(text: string): string {
  let t = text.trim().replace(/\s+/g, ' ');
  for (let i = 0; i < 3; i++) t = t.replace(FILLER_HEAD, '');
  t = t.replace(LEADING_VERB, '');
  // The leading article is kept: "Scrivi un articolo su X" reads correctly,
  // "Scrivi articolo su X" does not.
  t = t.replace(/^\s*(mi|me)\s+/i, '');
  // Partitives read wrong after a count blank ("Proponi 10 delle idee"), and
  // carry no meaning of their own.
  t = t.replace(/^\s*(delle|dei|degli|some|any)\s+/i, '');
  t = t.replace(/[?!.]+\s*$/, '').trim();
  if (/^(qualcosa|qualcuno|roba|cose|something|anything|stuff|niente|nothing)\b/i.test(t)) return '';
  if (t.length < 3) return '';
  return t;
}

// ── Assembly ───────────────────────────────────────────────────────────────

const LEAD: Record<Locale, Partial<Record<PromptIntent, string>>> = {
  it: {
    write: 'Scrivi', generate_code: 'Scrivi il codice per', explain: 'Spiega',
    summarize: 'Riassumi', translate: 'Traduci', analyze: 'Analizza',
    brainstorm: 'Proponi', classify: 'Classifica', extract: 'Estrai',
    convert: 'Converti', table: 'Metti in tabella', json: 'Restituisci in JSON',
    question: '', other: '',
  },
  en: {
    write: 'Write', generate_code: 'Write the code for', explain: 'Explain',
    summarize: 'Summarise', translate: 'Translate', analyze: 'Analyse',
    brainstorm: 'Suggest', classify: 'Classify', extract: 'Extract',
    convert: 'Convert', table: 'Put into a table', json: 'Return as JSON',
    question: '', other: '',
  },
};

/** Joining phrase placed before each blank, so the line reads as a sentence. */
const CONNECTOR: Record<Locale, Partial<Record<SlotId, string>>> = {
  it: {
    artifact: '', length: 'di', audience: 'per', tone: 'con tono',
    structure: 'strutturato come', language: 'in', constraints: '',
    errors: '', tests: '', depth: '', examples: '', focus: 'concentrandoti su',
    criteria: 'che siano', count: '', source: '', target: '',
    fields: 'i campi', schema: 'nel formato', categories: 'fra le categorie',
  },
  en: {
    artifact: '', length: 'of', audience: 'for', tone: 'in a',
    structure: 'structured as', language: 'in', constraints: '',
    errors: '', tests: '', depth: '', examples: '', focus: 'focusing on',
    criteria: 'that are', count: '', source: '', target: '',
    fields: 'the fields', schema: 'in the format', categories: 'among the categories',
  },
};

/**
 * Build a fill-in-the-blank scaffold for a prompt.
 *
 * Returns `slots` for a checklist UI and `template` for a one-line editable
 * suggestion. When the prompt already covers everything the intent needs,
 * `template` is empty — there is nothing useful to propose.
 */
export function buildScaffold(
  text: string,
  intent: PromptIntent,
  structure: PromptStructure,
  locale: Locale = 'it',
): PromptScaffold {
  const ids = BY_INTENT[intent] ?? BY_INTENT.other!;
  const subject = extractSubject(text);

  const slots: ScaffoldSlot[] = ids.map((id) => {
    const spec = SLOTS[id];
    return {
      id,
      label: spec.label[locale],
      filled: spec.isFilled(structure, text),
      options: spec.options[locale],
      why: spec.why[locale],
    };
  });

  const missing = slots.filter((s) => !s.filled);
  const filledCount = slots.length - missing.length;

  // A bare demonstrative is not a subject — "Riassumi questo" is asking about
  // something that is not in the prompt, and repeating it in the template
  // would suggest it were.
  // Bare demonstratives and container nouns are not subjects: "Riassumi
  // questo" and "Traduci il testo" are asking about something that is not in
  // the prompt, and echoing it would suggest otherwise.
  const usableSubject =
    /^((il |lo |la |i |le |gli |the )?(questo|questa|quello|quella|ci[oò]|this|that|it|testo|text|documento|document|contenuto|content|roba|cosa|cose))\s*$/i.test(subject)
      ? '' : subject;

  let template = '';
  if (missing.length > 0) {
    const lead = LEAD[locale][intent] ?? '';
    const head: string[] = [];
    const tail: string[] = [];

    for (const s of missing) {
      const c = CONNECTOR[locale][s.id] ?? '';
      const blank = c ? `${c} [${s.label}]` : `[${s.label}]`;
      // These name WHAT is produced or WHAT it operates on, so they belong
      // before the subject; everything else qualifies it and follows.
      if (s.id === 'artifact' || s.id === 'source' || s.id === 'count') head.push(blank);
      else tail.push(blank);
    }

    // Cap the line at three blanks. A template with five is a form, not a
    // suggestion, and reads as a rebuke rather than as help; the slots list
    // still carries the rest for anyone who wants them.
    const shown = [...head, ...tail].slice(0, 3);
    const headShown = shown.filter((b) => head.includes(b));
    const tailShown = shown.filter((b) => tail.includes(b));

    // "su X" only reads well when a blank precedes the subject and that blank
    // names an artefact. After a count or a pasted-material blank the subject
    // follows directly.
    const needsAbout = headShown.some((b) => b.includes(slots.find((x) => x.id === 'artifact')?.label ?? '\u0000'));
    const subjectPart = !usableSubject ? ''
      : needsAbout ? (locale === 'it' ? `su ${usableSubject}` : `about ${usableSubject}`)
      : usableSubject;

    const parts = [lead, ...headShown, subjectPart, ...tailShown].filter(Boolean);
    if (parts.length > 1) template = parts.join(' ').replace(/\s+/g, ' ').trim() + '.';
  }

  return { intent, subject, slots, template, filledCount, totalCount: slots.length };
}
