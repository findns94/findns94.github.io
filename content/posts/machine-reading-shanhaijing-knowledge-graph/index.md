---
title: "How Do You Machine-Read the Shanhaijing? 63 Contradictions, 447 Mountains, One Knowledge Graph"
description: "A rule-based pipeline read the 32,316-character Shanhaijing into 2,141 entities and 7,113 relations, then logged 63 contradictions unfixed (project KG, 2026)."
coverImage: "/posts/machine-reading-shanhaijing-knowledge-graph/images/cover.jpg"
coverImageAlt: "An ink-wash painting of misty karst peaks, a full moon and a lone fisherman in a small boat, evoking the mythic mountain landscapes catalogued in the Shanhaijing"
ogImage: "/posts/machine-reading-shanhaijing-knowledge-graph/images/cover.jpg"
date: "2026-10-21 10:00:00"
lastUpdated: "2026-10-21 10:00:00"
author: "FindNS94"
tags: [Shanhaijing, Knowledge Graph, Culture]
---

![An ink-wash painting of misty karst peaks, a full moon and a lone fisherman in a small boat, evoking the mythic mountain landscapes catalogued in the Shanhaijing](/posts/machine-reading-shanhaijing-knowledge-graph/images/cover.jpg)

The *Shanhaijing* (山海经, "Classic of Mountains and Seas") is a 2,300-year-old Chinese text that describes 447 mountains, their rivers, their minerals, their monsters, and the gods you must sacrifice to if you want to cross them safely. It is roughly 32,316 characters long — shorter than a single chapter of a modern novel. And it is, by any reasonable measure, a mess: chains that say "forty-six mountains" but list forty-seven, a chapter that declares "a hundred thousand mountains," and a nine-tailed fox that everybody has heard of and that the machine cannot find.

Over the past several months I built a knowledge graph out of it: 2,141 entities, 7,113 relations, 1,041 extracted record units, and 63 documented contradictions — none of them corrected. This post is the hub of a six-part series. It explains what machine-reading an ancient text actually produces, what the machine found that human readers have argued about for centuries, and why the most important design decision in the whole project was to **not fix anything**.

<!-- more -->

> **Key Takeaways**
> - The pipeline turned 32,316 characters of public-domain text into 2,141 entities across 15 types, 7,113 relations, and 447 mapped mountains in 26 chains.
> - It recorded 63 contradictions between chain tallies and chapter summary sentences — and flagged **zero** of them as its own bugs.
> - The largest apparent discrepancy — +10,090 li (429%) in the North Third Chain — turned out to be a parser bug, not a scribal error: the source already reads 萬二千三百五十里 (12,350 li).
> - Extraction is rule-based, not LLM-based: 5,896 spatial relations were generated with 0 LLM calls and 0 human edits.

## Why Machine-Read a 2,300-Year-Old Book at All?

Because the *Shanhaijing* is not really a book — it is a database that was written down before databases existed. Its core genre, the *Wuzang Shan Jing* (五藏山经), consists of 26 mountain chains, and each chain is a list of entries in a rigid template: "Three hundred li further east is Mount X. On its sunny side there is much Y; on its shady side there is much Z. There is a creature here shaped like A with the voice of B; eating it cures C." Every entry is a row. Every field is a column. The text has been waiting 2,300 years for someone to normalize it.

The scale of the thing is also exactly wrong for human reading and exactly right for machine reading. At 32,316 characters it is small enough that a full pipeline can be verified end to end — no sampling, no "good enough" coverage estimates. But it contains 447 mountains, ~300 watercourses, 277 animal types, and 100-plus polities by the traditional counts ([Wikipedia](https://zh.wikipedia.org/wiki/%E5%B1%B1%E6%B5%B7%E7%BB%8F), 2026). Nobody holds that in their head. Ask a human "which mountains produce cinnabar and also host a creature that cures insomnia?" and you get a shrug. Ask the graph and you get a list.

The legal question came first, and it shaped everything after. The standard modern editions — Yuan Ke's *Shanhaijing Jiaozhu* (1980) and *Jiaoyi* — are under copyright in China until 2051, since Yuan Ke died in 2001. They cannot be used as a base text. What can be used is Guo Pu's fourth-century annotated edition, which is public domain and available in full on Wikisource ([Wikisource](https://zh.wikisource.org/wiki/%E5%B1%B1%E6%B5%B7%E7%B6%93), 2026). Guo Pu's commentary survives in only three of the eighteen chapters — 105 notes in the Southern Mountains, 280 in the Western Mountains, five in the Eastern Sea Within — so the project treats the scripture itself, not the commentary, as the primary object. That single decision removed a decade of licensing risk and cost nothing.

<!-- [PERSONAL EXPERIENCE] I started this project expecting the hard part to be the weird characters — 狌狌, 猼訑, 帝江. It was not. The hard part was deciding, over and over, what to do when the text contradicted itself. -->

## What Does Machine-Reading the Shanhaijing Actually Produce?

It produces a countable artefact. The knowledge graph contains **2,141 entities across 15 types** and **7,113 relations**, derived from 447 mountains in 26 chains spanning a declared 97,358 li of travel. Of those relations, 5,896 are spatial (chain membership, adjacency, distance, water connections) and 1,217 are biological (what a mountain produces, what creature inhabits it, what it cures, what sacrifice it demands).

The entity distribution tells you immediately what kind of text this is. Mountains dominate at 576 canonical entities, followed by watercourses at 405 and minerals/products at 399 — the *Shan Jing* really is a mineral survey with monsters attached. Creatures come in at 272, polities and clans at 174, quantified distances at 117. Deities number just nine. Concepts number five. For a book famous for its gods, the *Shanhaijing* is remarkably stingy with them.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/machine-reading-shanhaijing-knowledge-graph/charts/chart-1-entity-type-distribution.svg"
       alt="Horizontal bar chart of 2,141 Shanhaijing entities by type: mountain 576, water course 405, mineral or product 399, creature 272, polity or clan 174, quantity 117, person 56, plant 39, omen 34, bird or beast 24, sacrifice 17, direction 12, deity 9, concept 5, identity 2"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

Above the entity layer sits a layer of **1,041 record units** — one entry per mountain, polity, or deity — sorted into seven formulaic sentence patterns. Pattern 1, the "products" sentence (其阳多X, "on its sunny side there is much X"), accounts for 448 of them. Pattern 4, the watercourse sentence, accounts for 253. The remaining five patterns cover creatures, plants, chain summaries, omens, and gods-and-people. This is the structural payoff of a text this formulaic: once you have the seven patterns, you have essentially the whole *Shan Jing* grammar.

A citation-ready summary of the scale: the Shanhaijing knowledge graph holds 2,141 entities in 15 types and 7,113 relations — 5,896 spatial and 1,217 biological — extracted from 447 mountains across 26 chains, with 1,041 record units assigned to seven formulaic sentence patterns ([project data](https://findns.cc/shanhaijing), 2026).

## What Can You Actually Do on the Site?

Five things, and each one exists because a different question kept coming up. The site lives at `/shanhaijing` and is a set of static pages built from the same graph data — no API, no database, no map provider.

**1. The panorama metro-map.** All 26 chains and 447 mountains drawn as a metro-style network, the way the *Shiji* knowledge base draws its timeline. Direction and distance become edges; mountains become stations. It is the only view where you can see that the *Shan Jing* is essentially 26 independent lines that never officially intersect.

**2. The mountain-focus view.** The panorama at full scale is honest but unreadable — 447 nodes is too much information density. The default view therefore shows exactly one mountain at a time, plus its immediate neighbours in its chain, with labelled arrows for the distance between them ("east, 300 li"). You move with the arrow keys, the neighbour cards, or a URL hash, so any mountain is a shareable link.

**3. The force-directed knowledge graph.** A hand-written SVG force simulation — no D3, no external graph library — where nodes are entities and edges are relations. You can drag nodes, filter by relation type, hover to highlight a neighbourhood, and click through to a detail view. It renders 200 nodes by default because more than that turns into hairball theatre.

**4. The entity pages.** Every one of the 2,141 entities has its own page: canonical name, type, every mountain where it appears, its relations, and the original passage with annotations intact. This is the part that answers the "which mountains produce cinnabar" question.

**5. The bilingual chapter reader.** All 18 chapters plus Guo Pu's preface, rendered side by side with an English translation, with every tagged entity clickable and colour-coded by type. Single-column mode is available for people who find side-by-side reading stressful.

![A sumi-e ink painting of a dark mountain ridge emerging from fog above a cloud sea, illustrating the mist-shrouded peaks the Shanhaijing catalogues one by one](/posts/machine-reading-shanhaijing-knowledge-graph/images/mountains-in-mist-sumi-e.jpg)

There is also a scoped search that knows the difference between a mountain name, a creature name, and a product name — a distinction that matters a great deal here, because 石山 is a mountain and 石 is a mineral and both appear thousands of times.

## What Did the Machine Find That Human Readers Have Long Argued About?

It found the arguments, quantified them, and refused to referee them. The pipeline's contradiction detector logged **63 conflicts** across the 26 chains. Twenty-four are distance mismatches between a chain's own tally and its closing summary sentence. Seventeen are cross-chapter clashes where the same mountain name appears in two different chains at incompatible positions. Twelve are textual corruptions. Seven are mountain-count mismatches. Three are unit-type errors.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/machine-reading-shanhaijing-knowledge-graph/charts/chart-2-conflict-taxonomy.svg"
       alt="Donut chart of the 63 Shanhaijing contradictions by type: 24 distance mismatches between chain tallies and summary sentences, 17 cross-chapter clashes over same-named mountains, 12 textual corruptions, 7 mountain-count mismatches, and 3 distance type errors"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

The single worst case is the North Third Chain (北次三經). Its closing summary sentence was recorded as declaring 46 mountains and 2,350 li, while the tally of the entries themselves comes to 12,440 li — a gap of 10,090 li, or **429%**. The resolution is one character. The summary sentence in the transmitted text reads 萬二千三百五十里; put the leading 萬 (ten thousand) back into the recorded figure and the declaration becomes 12,350 li, which is within 90 li of the tally. Whether you call that a scribal omission or a parsing blind spot, the gap collapses from 429% to under 1%. The full detective story, including why a later re-count of the same chain produced a different tally, is the subject of [the missing-character post](/posts/shanhaijing-missing-character-429-percent/).

The second headline finding is the opposite of a discovery: **the nine-tailed fox is not in the dataset.** The creature is the most famous thing in the book, and it has zero entity pages. The reason is textual, not technical. In the Western Mountains chapter, the text at Qingqiu Mountain reads 其状如狐而九尾 — "its shape is like a fox and it has nine tails" — and then **never names it**. The pipeline only creates creature entities for things that are named. The most iconic animal in the Shanhaijing is, grammatically speaking, an unnamed fox. That story is told in full in [the nine-tailed fox post](/posts/shanhaijing-nine-tailed-fox-missing/).

<!-- [ORIGINAL DATA] The North Third Chain reconciliation is genuinely unstable across pipeline layers: the structure layer tallies 12,440 li against a recorded declaration of 2,350 li (+10,090, 429%), while the later route layer, which re-derived the chain with double-counted watercourse segments removed, tallies 10,540 li (+8,190, 349%). Both numbers are far past any rounding error, and both point at the same 萬. I report both rather than picking the better headline. -->

## Why Rule-Based Extraction Instead of an LLM?

Because the *Shan Jing* is formulaic enough that a rule can beat a model, and because a rule can be audited. The pipeline uses a span tagger that collects all candidate annotation intervals first and then inserts them with a longest-match rule, so the three annotation layers can never nest or overlap. Every spatial relation in the graph — all 5,896 of them — was generated automatically, with **0 LLM calls and 0 human edits** recorded in the relation metadata.

<!-- [UNIQUE INSIGHT] The strongest argument against LLM extraction here is not accuracy — it is visibility. A rule that merges two variant readings can be inspected, dated and reverted. A model that merges them simply returns a shorter list, and nothing in the output tells you that a decision was made. -->

The argument for rules is not nostalgia. It is that an LLM asked to "extract the mountains from the Shanhaijing" will silently normalise. It will decide that 苟牀之山 and 苟林之山 are the same mountain and merge them. It will decide that 十萬山 is obviously a typo and quietly write "fifteen mountains." Both of those are real examples from this text. The first is a genuine variant reading that the project keeps as two entries. The second is a corruption the project records as conflict number twelve. An LLM would have produced a cleaner graph and destroyed the evidence.

The cost of the rule-based choice is honest and measurable: annotation coverage is **35.14%** — 11,041 of 31,418 characters carry at least one tag. The *Hai Jing* chapters sit at 11–21% coverage because their narrative prose does not fit the *Shan Jing* templates, and rather than guess, the tagger stays quiet. There is also a known ceiling on mountain names: the tagger limits mountain-name bodies to one or two characters, which means three-character names like 三天子鄣山 get missed. Those gaps are documented, not hidden.

## Why Does the Project Record Contradictions Instead of Fixing Them?

Because the contradictions are the scholarship. Every one of the 63 conflicts carries a traceable passage number, the original text, a written explanation, a set of competing hypotheses, and a confidence rating. Twenty-eight are marked confirmed, 17 suspected, 14 undecidable, and 4 explained. Thirty-two carry high confidence. And the field that matters most is `our_bug`: it is **zero**. Not one of the 63 is a parsing failure. They are all properties of the text.

That distinction was not free. An earlier version of the pipeline did report 22 conflicts as its own bugs — duplicated distance counting, mountain names swallowed as route endpoints, dropped segments. Those were fixed, and fixing them dropped `our_bug` to zero. What remained after the fix is the irreducible residue: a 429% distance gap, a chapter that claims a hundred thousand mountains, a 裏/里 character mixture inside a single distance phrase, and 黑水山焉 where the fixed formula of the entire book demands 黑水出焉.

The rule the project follows is simple and, I think, correct: **record, never repair.** The moment you repair, you have created a new edition — and a new edition needs an editor, a rationale, and a critical apparatus, which is exactly the work that Yuan Ke did and that is exactly the work still under copyright until 2051. Recording the contradiction keeps the base text reproducible and makes every scholarly judgement visible as a judgement.

## What Does "Three-Layer Coordinate Confidence" Mean?

It means the project refuses to pretend it knows where these mountains are. Of 820 places carrying coordinates, **405 are `confirmed`** (the entry has a complete direction-plus-distance chain, so it can be placed within its chain's frame), **42 are `inferred`** (the chain is broken by a missing distance), and **373 are `mythical`** (they are in the *Hai Jing*, which describes a geography that does not claim to be this world).

Three further rules keep the map honest. First, layer-2 coordinates are abstract plane coordinates measured in *li*, not latitude and longitude — they are relative positions inside a chain, and every one is flagged `estimated: true`. Second, layer-3 entries get topology only: the graph will tell you which polity sits inside which sea, and will not draw you a dot on a world map. Third, the *li* itself is never silently converted. A pre-Qin *li* is roughly 415 metres, but the project stores the original unit and never multiplies, because the conversion factor is itself a contested claim.

A citation-ready summary of the honesty policy: the Shanhaijing map layers 820 located places into 405 confirmed, 42 inferred, and 373 mythical, keeps all layer-2 coordinates as `estimated: true` plane positions in li rather than latitude/longitude, and gives layer-3 entries topology only ([project data](https://findns.cc/shanhaijing), 2026).

## What Does the Six-Post Series Cover?

Each post takes one thread of the project and pulls it all the way out. Read in order, they run from the data to the philosophy to the engineering.

1. **[How Do You Machine-Read the Shanhaijing?](/posts/machine-reading-shanhaijing-knowledge-graph/)** — this post: the overview, the numbers, and the design decisions behind all five site features.
2. **[The 63 Contradictions](/posts/shanhaijing-63-contradictions-machine-reading/)** — a tour of every conflict category, with the individual cases that make the pattern legible.
3. **[Building the Knowledge Graph](/posts/shanhaijing-knowledge-graph-pipeline/)** — the pipeline itself: structure, annotation, record units, spatial and biological relations, and the lint layer that keeps them honest.
4. **[Zero-Dependency Visualization](/posts/shanhaijing-zero-dependency-visualization/)** — how the metro-map, the force-directed graph and the focus view were written by hand in SVG, and why "no D3" was a design constraint rather than a stunt.
5. **[The Nine-Tailed Fox That Isn't There](/posts/shanhaijing-nine-tailed-fox-missing/)** — what it means when the most famous creature in a text has no entity page, and why that is the correct outcome.
6. **[The Parser Bug That Looked Like a 2,300-Year-Old Typo](/posts/shanhaijing-missing-character-429-percent/)** — how a dropped 萬 in the parser, not the text, manufactured a 429% gap, and how to tell the two apart.

## Frequently Asked Questions

### How many entities and relations does the Shanhaijing knowledge graph contain?

It contains 2,141 entities across 15 types and 7,113 relations, split into 5,896 spatial and 1,217 biological relations, extracted from 447 mountains in 26 chains ([project data](https://findns.cc/shanhaijing), 2026). The entities are de-duplicated by canonical name, so the 576 canonical mountains are fewer than the 702 tagged mountain mentions in the annotated text.

### Why does the project use rules instead of an LLM for extraction?

Because the *Shan Jing* is written in seven repeating sentence patterns, so rules generalise almost completely — all 5,896 spatial relations were extracted with 0 LLM calls. An LLM would also silently normalise real textual variants and corruptions, destroying the 63 conflicts that are the project's most interesting output.

### Are the Shanhaijing contradictions real problems with the text?

Mostly — but the largest headline is the exception that proves the rule. The pipeline's own-bug counter is zero for the 63 catalogued conflicts ([project conflict report](https://findns.cc/shanhaijing), 2026), yet the biggest single gap, a 429% distance discrepancy in the North Third Chain, proved to be a parser defect (a dropped leading 萬), not a textual one. Auditing the derived number before blaming the source is exactly what caught it.

### How many mountains does the Shanhaijing actually have?

447, if you count the summary sentences of the 26 chains in the *Wuzang Shan Jing* — the convention that matches Tan Qixiang's historical-geography work. Other conventions give 477 or 550 ([Wikipedia](https://zh.wikipedia.org/wiki/%E5%B1%B1%E6%B5%B7%E7%BB%8F), 2026). The project stores the counting convention alongside every total, because the number is meaningless without it.

### Can I use the Shanhaijing data or code?

The base text is public domain — Guo Pu's edition via Wikisource — and all 2,141 entity pages, the five visualisations and the bilingual reader are browsable at `/shanhaijing`. The project deliberately avoids Yuan Ke's copyrighted 1980 editions, which remain protected until 2051.

## Conclusion

Machine-reading the *Shanhaijing* turned out not to be a natural-language-processing problem. The text is too regular for that. It turned out to be an editorial problem: what do you do when a 2,300-year-old list of mountains tells you two different things about the same mountain, and both readings have defenders?

The answer this project chose is to build a machine that counts rather than a machine that decides. 2,141 entities, 7,113 relations, 447 mountains, 1,041 record units, 63 contradictions, and a bug counter at zero. The graph is less tidy than it could have been, and considerably more useful.

Start with [the panorama](/shanhaijing/panorama/) if you want the shape of the book, [the mountain-focus view](/shanhaijing/map/) if you want to read one entry at a time, or [the 63 contradictions](/posts/shanhaijing-63-contradictions-machine-reading/) if you want to see what the machine found that we have been arguing about for two thousand years.

## Sources

- Wikisource, 《山海經》 (Guo Pu annotated edition, public domain base text, 18 chapters), retrieved 2026-10-21, https://zh.wikisource.org/wiki/%E5%B1%B1%E6%B5%B7%E7%B6%93
- Wikipedia, "山海经" (authorship, dating, chapter structure, and the 550-mountain counting convention), retrieved 2026-10-21, https://zh.wikipedia.org/wiki/%E5%B1%B1%E6%B5%B7%E7%BB%8F
- Shanhaijing knowledge graph, entity index, relation tables, route data and map layers (2,141 entities / 7,113 relations / 447 mountains / 26 chains), retrieved 2026-10-21, https://findns.cc/shanhaijing
- Shanhaijing conflict report (SKILL_07g), 63 recorded contradictions across 26 chains with verdicts and confidence tiers, retrieved 2026-10-21, https://findns.cc/shanhaijing
- Shanhaijing route reconciliation (SKILL_03n), per-chain counted-versus-declared distance and mountain totals, retrieved 2026-10-21, https://findns.cc/shanhaijing
- Pixabay, "Chinese Ink Painting, Misty Mountains, Traditional Landscape" (cover image, Pixabay Content License), retrieved 2026-10-21, https://pixabay.com/illustrations/chinese-ink-painting-misty-mountains-9740667/
- Pixabay, "Sumi, Sumi-E, Watercolor" (inline image, Pixabay Content License), retrieved 2026-10-21, https://pixabay.com/illustrations/sumi-sumi-e-mountains-painting-1595365/
