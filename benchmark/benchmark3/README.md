# benchmark3 — behavioural specification

**This is not independent ground truth.** The prompts and their expected bands were both
written during development, so the labels encode the intended behaviour of the engine rather
than an outside judgement of prompt quality. Treat it as a regression net and a specification,
never as evidence of accuracy — that is what benchmark1 and benchmark2 are for.

What it is good for: it covers, deliberately and in both languages, the classes that this
engine has historically got wrong, several of which are thin or absent in the other two sets.

- **self_bounding** — short prompts that are complete ("Codice ISO della Norvegia"). The engine
  used to cap these for having no imperative verb.
- **fair_zone** — a real request with no constraints. The middle band is the weakest part of
  the scale: only 16% of medium prompts were labelled medium.
- **followup** — valid mid-thread instructions, which score badly when the turn hint is missing.
- **courtesy** — politeness around a real request (fine, a suggestion at most) versus politeness
  with no request at all (a defect).
- **not_contradiction / not_tautology / template_filled** — near misses for detectors that fire
  too eagerly. These matter more than the positive cases: they are where a rule turns from a
  signal into a nuisance.

Each entry carries `band` (bad / medium / good) rather than a number, because the product shows
a band and a number would imply a precision the labels do not have.
