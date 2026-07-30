/**
 * promptlint-core — Cap metadata (scoring)
 *
 * Two exported constants used by scorePrompt() in scoring/index.ts:
 *
 *   CAP_REASON_TEXT — human-readable description of each poison cap reason,
 *     in both IT and EN. Used both in the score.summary line and in the
 *     coherence projection (to set dimension.why to the cap's reason so the
 *     user sees WHY a dimension bar is low, not just that it is).
 *
 *   CAP_TO_DIM — maps each cap label to the dimension it "belongs to" for
 *     the coherence projection. When a decisive cap floors the total,
 *     the mapped dimension is floored to total+15 so bars and total agree.
 *
 * Keeping these here (rather than inline in the 1300-line scorePrompt body)
 * makes them easy to extend without navigating the full scorer logic.
 */

// Human-readable reason for each poison cap, in both UI locales.
// Referenced twice: (a) the summary line ("Focus: <reason>") when a cap
// actually bound the total, and (b) the per-dimension `why` string when the
// COERENCE PROJECTION below floors a dim so the user sees WHY the bar is
// low, not just that it is. Kept at module scope so both sites read the
// same source and stay in sync.
export const CAP_REASON_TEXT: Record<string, { it: string; en: string }> = {
  genre_self_exclusion: { it: 'contraddizione: il pubblico escluso coincide con il target naturale del contenuto richiesto', en: 'contradiction: the excluded audience is the natural target of the requested content' },
  contradiction: { it: 'istruzioni in conflitto tra loro', en: 'conflicting instructions' },
  no_task: { it: 'nessuna azione concreta richiesta', en: 'no concrete action requested' },
  courtesy_filler: { it: 'solo cortesia, nessuna richiesta reale', en: 'only courtesy, no real request' },
  role_without_task: { it: 'assegna un ruolo ma nessun compito', en: 'assigns a role but no task' },
  total_delegation: { it: 'delega ogni scelta al modello', en: 'delegates every choice to the model' },
  self_bounding_no_object: { it: 'verbo senza un oggetto su cui operare', en: 'verb with no object to act on' },
  self_bounding_no_material: { it: 'nessun materiale concreto da elaborare', en: 'no concrete material to process' },
  synonymic_redundancy: { it: 'ripete più sinonimi senza aggiungere contenuto', en: 'repeats several synonyms without adding content' },
  morphological_redundancy: { it: 'ripete la stessa radice in forme diverse', en: 'repeats the same root in different forms' },
  semantic_pair_redundancy: { it: 'coppia di parole semanticamente ridondanti', en: 'semantically redundant word pair' },
  repeated_content_word: { it: 'parola di contenuto ripetuta senza motivo', en: 'content word repeated without reason' },
  negative_only_constraints: { it: 'solo vincoli negativi, nessuna specifica positiva', en: 'only negative constraints, no positive spec' },
  mutually_exclusive_format: { it: 'richiede due formati incompatibili tra loro', en: 'asks for two mutually incompatible formats' },
  literal_media_placeholder: { it: 'riferimento a un file/immagine non realmente allegato', en: 'reference to a file/image that is not actually attached' },
  implicit_prior_reference: { it: 'riferisce materiale precedente mai fornito', en: 'refers to prior material never provided' },
  low_information_density: { it: 'contenuto quasi tutto generico, poco concreto', en: 'content almost entirely generic, little that is concrete' },
  meta_usage_unclear: { it: 'chiede come usare il modello invece di dare un compito', en: 'asks how to use the model instead of giving a task' },
  unfilled_template: { it: 'contiene placeholder non compilati', en: 'contains unfilled placeholders' },
  core_vocabulary_misspelled: { it: 'errori di battitura sulle parole chiave del compito', en: "typos on the task's key words" },
  missing_reference: { it: 'riferisce materiale esterno non fornito', en: 'refers to external material not provided' },
  bare_acknowledgment: { it: "solo un'espressione di assenso, nessun compito", en: 'just an acknowledgment, no task' },
  empty_object: { it: 'oggetto del compito vuoto o non specificato', en: "the task's object is empty or unspecified" },
  ultra_short: { it: 'troppo corto per essere eseguibile', en: 'too short to be actionable' },
  very_short_no_task: { it: 'troppo corto e senza un compito', en: 'too short and without a task' },
  polite_filler: { it: 'cortesia eccessiva senza contenuto', en: 'excessive courtesy without content' },
  pure_repetition: { it: 'ripetizione pura senza nuovo contenuto', en: 'pure repetition without new content' },
  vague_adjectives: { it: 'aggettivi vaghi senza specifiche concrete', en: 'vague adjectives without concrete specifics' },
  ambiguity: { it: 'riferimenti ambigui nel testo', en: 'ambiguous references in the text' },
  underspecified_vague: { it: 'quasi nessuna specifica: il modello deve indovinare tutto', en: 'almost no specs: the model has to guess everything' },
  underspecified_short: { it: 'poche specifiche e testo corto', en: 'few specs and short text' },
  underspecified: { it: 'nessuna delle sei specifiche fondamentali è presente', en: 'none of the six core specs is present' },
  underspecified_named: { it: 'oggetto concreto ma nessuna specifica ulteriore', en: 'concrete object but no further specs' },
  impossible_budget: { it: 'limite di lunghezza incompatibile con il numero di elementi richiesti', en: 'length constraint incompatible with the number of items requested' },
  impossible_temporal: { it: 'vincolo temporale irrealistico per un modello', en: 'unrealistic time constraint for a model' },
  vague_topic_question: { it: 'domanda su un argomento vago, senza deliverable concreto', en: 'question about a vague topic, with no concrete deliverable' },
  // v2.26 new caps
  instruction_override: { it: 'tentativo di manipolazione o injection del prompt', en: 'prompt injection or manipulation attempt' },
  scope_overload: { it: 'troppe richieste per una singola risposta', en: 'too many deliverables for a single response' },
  // Added with the coverage work. Both caps existed and bound the score since v3, but had no
  // reason text and no advice entry, so the postProcess layer lowered the score
  // and said nothing. See CAP_SURFACEABLE in postprocess.ts.
  tautology_long: { it: 'la frase gira su sé stessa: definisce un termine con lo stesso termine', en: 'the sentence turns on itself: it defines a term using the same term' },
  harmful: { it: 'richiesta che i modelli rifiutano di eseguire', en: 'request that models decline to carry out' },
  revision_no_criterion: { it: 'chiede di rifare senza dire cosa cambiare', en: 'asks for a redo without saying what to change' },
  prior_session: { it: 'presuppone che il modello ricordi uno scambio precedente', en: 'assumes the model remembers an earlier exchange' },
  contextless_consulting: { it: 'chiede un consiglio senza dire su cosa', en: 'asks for advice without saying about what' },
  rhetorical: { it: 'domanda retorica: chiede consenso, non lavoro', en: 'rhetorical question: asks for agreement, not work' },
  scope_explosion: { it: 'più lavori indipendenti chiesti in un solo messaggio', en: 'several independent jobs asked for in one message' },
  dangling_reference: { it: 'riferimento a qualcosa non presente nel prompt', en: 'reference to something not in the prompt' },
  underspecified_degraded: { it: 'oggetto presente ma contenuto degradato (ridondanza, vaghezza)', en: 'object present but degraded content (redundancy, vagueness)' },
  underspecified_followup: { it: 'sembra un followup — in contesto potrebbe essere valido', en: 'looks like a followup — may be valid in context' },
};

// ─── Cap → dimension mapping (coherence projection) ──────────────────────────
// When a decisive cap binds the total, the dimension in this map is floored
// to total+15 so the UI's bars agree with the total. See scorePrompt() in
// scoring/index.ts for the projection logic.
export const CAP_TO_DIM: Record<string, 'clarity' | 'precision' | 'redundancy'> = {
  // Contradiction family — model can't satisfy both instructions
  contradiction:             'clarity',
  genre_self_exclusion:      'clarity',
  mutually_exclusive_format: 'clarity',
  impossible_budget:         'clarity',
  impossible_temporal:       'clarity',
  // Reference-failure family — model doesn't know what "it" points to
  implicit_prior_reference:  'clarity',
  literal_media_placeholder: 'clarity',
  missing_reference:         'clarity',
  core_vocabulary_misspelled:'clarity',
  unfilled_template:         'clarity',
  // Spec-empty / delegation / courtesy — no real content to act on
  no_task:                   'precision',
  empty_object:              'precision',
  role_without_task:         'precision',
  total_delegation:          'precision',
  self_bounding_no_object:   'precision',
  self_bounding_no_material: 'precision',
  meta_usage_unclear:        'precision',
  vague_topic_question:      'precision',
  negative_only_constraints: 'precision',
  low_information_density:   'precision',
  underspecified_vague:      'precision',
  underspecified_short:      'precision',
  underspecified:            'precision',
  underspecified_named:      'precision',
  underspecified_degraded:  'precision',
  underspecified_followup:  'precision',
  instruction_override:     'clarity',
  scope_overload:           'precision',
  dangling_reference:       'clarity',
  courtesy_filler:           'precision',
  polite_filler:             'precision',
  bare_acknowledgment:       'precision',
  // Redundancy family
  synonymic_redundancy:      'redundancy',
  morphological_redundancy:  'redundancy',
  semantic_pair_redundancy:  'redundancy',
  repeated_content_word:     'redundancy',
  pure_repetition:           'redundancy',
}

export type CapToDimType = Record<string, 'clarity' | 'precision' | 'redundancy'>;
