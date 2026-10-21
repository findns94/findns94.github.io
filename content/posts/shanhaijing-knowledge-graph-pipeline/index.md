---
title: "447 Sacred Mountains as a Subway Map: Building a Shanhaijing Knowledge Graph"
description: "The Shanhaijing build turns 32,316 characters into 2,141 entities and 7,113 relations — 88.3% auto-extracted by regex rules, zero by LLM (project data, 2026)."
coverImage: "/posts/shanhaijing-knowledge-graph-pipeline/images/cover.jpg"
coverImageAlt: "A Song dynasty blue-green landscape painting of dense mountain peaks with three coloured metro-style transit lines and station dots overlaid, representing 447 Shanhaijing mountains plotted as a subway map"
ogImage: "/posts/shanhaijing-knowledge-graph-pipeline/images/cover.jpg"
date: "2026-10-21 10:00:00"
lastUpdated: "2026-10-21 10:00:00"
author: "FindNS94"
tags: [Shanhaijing, Knowledge Graph, Data Science]
---

![A Song dynasty blue-green landscape painting of dense mountain peaks with three coloured metro-style transit lines and station dots overlaid, representing 447 Shanhaijing mountains plotted as a subway map](/posts/shanhaijing-knowledge-graph-pipeline/images/cover.jpg)

# 447 Sacred Mountains as a Subway Map: Building a Shanhaijing Knowledge Graph

The *Classic of Mountains and Seas* (山海经) lists 447 named mountains arranged in 26 chains, and its closing sentences claim the walk between them adds up to 97,358 *li* — roughly 40,000 kilometres, about the circumference of the Earth. Nowhere does the text tell you where any of those mountains actually are. There are no coordinates, no dynastic dates, no maps in the received text. What the book gives you instead is pure topology: "three hundred *li* further east, there is such-and-such mountain." That is exactly the information a subway map carries, and it is exactly the information a knowledge graph can hold.

This is post 3 of a 6-post series on machine-reading the *Shanhaijing*. The [series hub](/posts/machine-reading-shanhaijing-knowledge-graph/) covers what the project is and why it exists. This post is the engineering deep dive: how the annotation system is designed, how the extraction pipeline works, what the knowledge graph actually contains, and — the part most write-ups skip — which parts of the declared schema are still empty.

<!-- more -->

> **Key Takeaways**
> - The *Shanhaijing* knowledge graph holds **2,141 entities across 15 populated types** and **7,113 relations** — 5,896 spatial plus 1,217 biology (project data, 2026).
> - Relations are extracted by **rule-based regex over an annotated corpus, not by LLM inference**: 88.3% of spatial relations and 89.2% of biology relations land in the auto high-confidence tier, and zero relations come from LLM inference.
> - The annotation layer uses **three disjoint symbol families** — entities `〖…〗`, idioms `〘…〙`, verbs `⟦…⟧` — so tag syntax never collides with Markdown.
> - 1,041 record units in **7 sentence patterns (P1–P7)** are the bridge between raw prose and graph edges; one mountain entry equals one record.
> - The build script merges **12 JSON sources** into 6 per-component files behind **29 hard assertions**, ships zero runtime dependencies, and exits cleanly when the source corpus is absent in CI.

## What Does the Shanhaijing Knowledge Graph Actually Contain?

It contains 2,141 canonical entities, 5,896 spatial relations and 1,217 biology relations, built from 18 chapters and roughly 32,316 characters of classical Chinese. The whole thing is static JSON — no database, no server, no query engine. Fifteen entity types are populated; the largest are mountains (576), watercourses (405), minerals and products (399), and creatures (272).

The two relation families are deliberately asymmetric. Spatial relations describe where things are relative to each other; biology relations describe what lives where and what it does to you if you eat it.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-knowledge-graph-pipeline/charts/chart-1-relation-type-distribution.svg" alt="Two-panel horizontal bar chart. Panel A, spatial relations totalling 5,896: in_chain 4,824, adjacent_to 438, distance_from 405, water_connect 221, located_at 8. Panel B, biology relations totalling 1,217: produces 803, inhabits 271, has_efficacy 90, sacrificed_at 24, descends_from 20, alias_of 6, same_as 3." loading="lazy" style="max-width:100%;height:auto">
  <figcaption>Source: project build artifacts <code>spatial_relations.json</code> and <code>biology_relations.json</code> (SKILL_05f / SKILL_05g), 2026-10-16</figcaption>
</figure>

Two numbers deserve a note. First, `in_chain` at 4,824 is not a bug — it is the undirected pairwise closure of "same mountain chain", so a 9-stop chain contributes 36 pairs and a 40-stop chain contributes 780. It is the graph saying "these mountains belong to the same itinerary." Second, `located_at` has only 8 rows, because the *Shanhaijing* rarely states an absolute position; it almost always states a relative one.

> **Citation capsule:** The *Shanhaijing* knowledge graph contains 2,141 entities across 15 populated types and 7,113 relations — 5,896 spatial (`in_chain` 4,824, `adjacent_to` 438, `distance_from` 405, `water_connect` 221, `located_at` 8) plus 1,217 biology (`produces` 803, `inhabits` 271, `has_efficacy` 90, and four smaller types). Source: project build artifacts, October 2026.

## How Do You Annotate a 2,300-Year-Old Text Without Breaking It?

You add a bracket layer that the original text cannot contain, and you make the three bracket families mutually exclusive. The annotation layer never edits, reorders, or normalises a single original character — it only wraps spans. After stripping every tag, the plain text must be byte-for-byte identical to the source, and a linter enforces that on every chapter.

The three families are deliberately drawn from Unicode ranges that Markdown and classical Chinese punctuation never use:

| Layer | Brackets | Codepoints | What it marks | Example |
|---|---|---|---|---|
| Entity | `〖 … 〗` | U+3016 / U+3017 | Objects in the world | `〖=招搖之山〗` |
| Idiom | `〘 … 〙` | U+3018 / U+3019 | Fixed phrases in the language itself | `〘※…〙` |
| Verb | `⟦ … ⟧` | U+27E6 / U+27E7 | Actions and relations | `⟦○名曰⟧` |

Inside the entity brackets sits a single type symbol. Twenty noun classes are declared, and two verb classes sit in the verb brackets:

```
=  mountain        ~  watercourse     +  creature       *  plant
?  deity           ◆  polity          •  mineral        ^  sacrifice
:  shrine          !  direction       $  distance       [  omen
@  person          #  identity        %  time           _  concept
{  book            &  tribe           <  bird/beast     >  direction section
◈  motion verb     ○  relation verb
```

The choice of `〖〗` (U+3016/3017, "white lenticular brackets") and `⟦⟧` (U+27E6/27E7, "mathematical white square brackets") is not aesthetic. Ten of the twenty type symbols — `#`, `_`, `[`, `$`, `:`, `{`, `~`, `<`, `>`, `&` — are also Markdown syntax. Wrapping them in a bracket pair the Markdown parser does not recognise keeps them inert: `〖#身份〗` cannot open a heading, `〖_概念〗` cannot open an emphasis run. The symbols stay human-readable inside the brackets and harmless outside the renderer.

<!-- [UNIQUE INSIGHT] The annotation spec declares 20 noun classes, but the shipped index populates only 15. Five classes — shrine `:`, time `%`, book `{`, tribe `&`, and direction-section `>` — are empty in the corpus, and the motion-verb class `◈` is empty too. The tagger is configured to skip rather than guess, so an empty class means "the text has no instances we can defend", not "the tool is broken". This is a deliberate design outcome: the pipeline prefers a smaller, verifiable schema to a nominally complete one. -->

Disambiguation has two mechanisms. The inline form is `〖TYPE display|canonical〗`, where the text before the pipe is rendered and the text after it feeds the index and tooltips:

```
〖=招搖之山|南山經-招搖之山〗
```

The external form is a JSON map, and in this project it is the one actually in use: 241 records keyed by name, each listing the chapters in which the name recurs. The most ambiguous entry is 三百里 — "three hundred *li*" — which appears in 13 different chapters, followed by 150 names that recur in exactly two.

<!-- [ORIGINAL DATA] A census of the 18 tagged chapters counts 4,104 entity tags and 108 verb tags. The idiom family `〘〙` appears zero times, and the inline disambiguation syntax `〖TYPE display|canonical〗` also appears zero times — all 241 disambiguation records live in the external JSON map instead. Both are cases where a declared feature was built but not exercised by this corpus. -->

## How Does a Rule-Based Tagger Decide Which Span Wins?

It collects every candidate span first, then resolves overlaps by longest-match, and only then writes the brackets. The tagger is a `SpanTagger` class that never edits text in place: every rule registers `(start, end, symbol)` triples, and rendering happens once at the end after a deterministic sort.

That ordering matters more than it sounds. If you insert brackets as you match, every later offset shifts, and a long match that should have won can end up straddling an already-inserted short one. Collecting first makes the whole pass index-stable. The resolution rule is:

```python
ordered = sorted(self.spans, key=lambda s: (s[0], -(s[1] - s[0]), s[2]))
```

Reading left to right, longest span first, ties broken by symbol — the first span to claim a region keeps it and any overlapping candidate is dropped. That single line is what guarantees the three families stay mutually exclusive: an entity can never end up nested inside a verb, because the inner span is simply never emitted.

The rules themselves are guards over regular expressions rather than bare patterns. A mountain-name rule will match a two-character string followed by 之山, but a guard rejects the match if the preceding character is a direction word or a numeral, because `又東三百里，曰堂庭之山` must yield `〖!東〗` `〖$三百里〗` `〖=堂庭之山〗` — three separate spans — not one span that swallows the bearing and the distance.

<!-- [PERSONAL EXPERIENCE] The hardest boundary in the whole project was the mountain name itself. Classical Chinese mountain names are frequently one or two characters — 柢山, 基山, 羽山 — and a two-character match window will happily swallow the verb or preposition that follows. The fix was to cap the name body at one to two characters and accept that longer proper names like 三天子鄣山 will be missed. Missing a mountain is recoverable; mis-tagging one corrupts the chain that every spatial relation is built on. -->

The strategy is documented as 宁缺勿错 — "rather leave it out than get it wrong" — and it shows up in the acceptance criteria: zero substantive text differences against the source, zero nested tags, zero boundary errors. Annotation coverage lands at 35.14% of characters, which sounds low until you remember that function words, particles, and the formulaic "there is a creature here, its shape is like…" scaffolding carry no entity content.

## What Are the Nine Stages of the Pipeline?

Nine, and they are strictly ordered because each stage consumes the previous stage's IDs. The dependency chain is the whole architecture: get the paragraph numbering wrong and every entity reference, every relation's provenance field, and every map coordinate has to be rebuilt.

| # | Stage | Output | Notes |
|---|---|---|---|
| 01 | Collation | `chapter_md/*.tagged.md` | Punctuation, variant characters, dual commentary layers |
| 02 | Structure | Paragraph numbers `（NNN-PPP）`, 26 chains, 18 chapters | Chain head, per-mountain entries, closing summary sentence |
| 03 | Entities | 2,141 entities, aliases, disambiguation map | 20 declared noun classes, 2 verb classes |
| 04 | Record units | 1,041 records in 7 patterns (P1–P7) | Replaces the "event" model used for historical texts |
| 05 | Relations | 5,896 spatial + 1,217 biology relations | Pure rule extraction over stages 03 and 04 |
| 06 | Ontology | 133 classified entities, 5 taxonomy files | L1–L5 classification ladder |
| 07 | Reasoning | 63 recorded contradictions | Cross-checks totals against per-item sums |
| 08 | Knowledge management | Coverage metrics, quality gates | Text integrity, symbol whitelist, boundary errors |
| 09 | Application | Map, panorama, entity browser, search | Consumes the JSON emitted by the build script |

Stage 04 is the conceptual pivot. The sibling project for a historical corpus models *events* — battles, accession, edicts — each with a date and a cast of people. The *Shanhaijing* has almost none of that. What it has is a repeated description template, so the pipeline replaces "event" with "record unit": a single atomic statement extracted from a single sentence.

## Why Is This Extraction Rule-Based Instead of LLM-Based?

Because the text is formulaic, and formulaic text is cheaper and more auditable to parse with rules. Every relation in the graph records how it was produced, and the answer for 7,105 of 7,113 relations is a deterministic pattern match over the annotated corpus. LLM inference contributed zero.

The provenance fields are explicit. Each relation carries an `auto` boolean, an `evidence_type` string naming the pattern that fired (`chain_step_exact`, `product_pattern`, `creature_pattern`, `efficacy_pattern`, `sacrifice_pattern`, `genealogy_pattern`, `water_flow`, `explicit_location`), and a confidence object with a score, a tier, and the list of signals that produced it.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-knowledge-graph-pipeline/charts/chart-2-extraction-provenance.svg" alt="Stacked horizontal bar chart comparing confidence tiers of Shanhaijing relations. Spatial relations total 5,896: tier A 5,206 (88.3%), tier B 690 (11.7%), tier C 0, tier D 0. Biology relations total 1,217: tier A 1,086 (89.2%), tier B 127 (10.4%), tier C 1 (0.1%), tier D 3 (0.2%). A callout states that LLM-inferred relations total zero and human-authored relations total eight." loading="lazy" style="max-width:100%;height:auto">
  <figcaption>Source: project build artifacts <code>spatial_relations.json</code> and <code>biology_relations.json</code> confidence tier distributions, 2026-10-16</figcaption>
</figure>

The tiers are not decorative. A spatial relation scores 0.95 when a chain step has a complete bearing and an exact distance, and drops to 0.85 when the chapter's closing summary sentence disagrees with the sum of the per-step distances by more than five percent. That downgrade is honest bookkeeping: the individual step is still trustworthy, but the chain it belongs to has a textual problem, so the relation is flagged for review rather than silently promoted.

> **Citation capsule:** Of 5,896 spatial relations, 5,206 (88.3%) reach the auto high-confidence tier and 690 (11.7%) are downgraded to tier B because their parent chain's stated total disagrees with the summed distances. Of 1,217 biology relations, 1,086 (89.2%) reach tier A. Zero relations in either family were produced by LLM inference. Source: project build artifacts, October 2026.

That 11.7% is not noise to be tuned away. It is the pipeline detecting that the source text contradicts itself — which is the subject of [post 2 in this series](/posts/shanhaijing-63-contradictions-machine-reading/), where 63 such contradictions are catalogued and deliberately left uncorrected. The most dramatic is a single mountain chain whose stated total and summed distances diverge by thousands of li, a gap far too large for rounding to explain; [post 6](/posts/shanhaijing-missing-character-429-percent/) audits that one discrepancy in full.

## How Do 1,041 Record Units Become 7,113 Relations?

Through seven sentence patterns. The *Shanhaijing* is not free prose; it is a template repeated 447 times with slot fillers. Once you write one regex per pattern, the graph mostly falls out of the matches.

| Pattern | Shape | Records |
|---|---|---:|
| P1 product | `X山，其陽多A，其陰多B` | 448 |
| P4 watercourse | `X水出焉，而南流注于Y` | 253 |
| P2 creature | `有獸焉，其狀如Y而Z，其名曰W` | 191 |
| P5 chain summary | `凡X山之首，自Y至于Z，凡N山，M里` | 57 |
| P3 plant | `有草焉，其狀如Y，其名曰W，食之不Z` | 41 |
| P7 omen | `見則其國大旱` | 31 |
| P6 deity/person | `有人曰X，Y形` | 20 |

Each pattern fills a fixed field set. A P2 creature record carries the creature's name, its morphological description broken into a prototype and a list of differences, its posture, its cry, its pattern, and its behaviour. A P4 watercourse record carries the source mountain, the flow bearing, and the destination water body. A P7 omen record carries the trigger creature and the consequence.

![A woodblock illustration of the one-legged creature Kui with vertical Chinese caption text, from Wu Renchen's 1667 expanded edition of the Classic of Mountains and Seas](/posts/shanhaijing-knowledge-graph-pipeline/images/kui-creature-woodblock.jpg)

The Kui is a textbook P2 record. The text gives it a name, a prototype (an ox), a set of differences (blue-green body, no horns, one leg), a behaviour (it enters and leaves water), and — because it is also an omen — a P7 record about wind and rain following it. Two patterns, two record units, two different relation families, one sentence in the source.

The extraction rules are guarded by fifteen explicit invariants that a verification pass re-checks independently. Three of them do most of the work. "No X" never generates a relation — 無草木 does not mean the mountain produces nothing, it means the text declined to enumerate. The `inhabits` edge always points creature → mountain while `produces` always points mountain → product, so the two families can never be confused. And a genealogy edge requires an explicit 生 character; 妻 and 孫 are not promoted without their own relation types.

That discipline is also why one famous creature is missing from the graph. The nine-tailed fox appears in the *Shanhaijing*, but at the mountain where it lives the text describes it rather than naming it — 其狀如狐而九尾, "its shape is like a fox with nine tails" — so no named creature entity exists and no `inhabits` edge was generated. [Post 5 in this series](/posts/shanhaijing-nine-tailed-fox-missing/) is about that gap and why the pipeline chose to leave it visible rather than paper over it with an inferred name.

## Inside the Build Script: 12 Sources, 6 Files, 29 Assertions

It merges 12 read-only JSON sources into 6 per-component files, checks 29 hard assertions, and refuses to emit anything if an invariant breaks. The script is `scripts/build-shanhaijing-data.mjs`, and it runs as a `prebuild` step.

The 12 inputs are the chain map, 26 route files, creature sightings, place products, chapter texts, the entity index, the taxonomy, the alias map, spatial relations, biology relations, the disambiguation map, and the 447 mountain positions. The outputs are one monolithic `data.json` plus six split files — `panorama-data`, `panorama-layout`, `map-data`, `graph-data`, `entity-data`, `search-data` — plus a lightweight `meta.json` and a flat `entity-names.json` used for client-side annotation.

The split is the interesting part. `graph-data.json` carries only entities and the two relation families, so the graph view loads 5.5 MB of graph and nothing else. `search-data.json` carries entities, sightings, products and chains, so the search box never touches the relation tables. The single-file version still exists for compatibility, but every page in the shipped site loads a slice.

The 29 assertions are the real specification. Twelve are global invariants — exactly 26 chains, exactly 447 stations, exactly 2,141 entities, exactly 5 spatial relation types, exactly 7 biology relation types, at least 200 disambiguation records, exactly 5 chapters of mountain positions, plus spot-checks on named records. The other seventeen are a regression table for chain-name extraction:

```js
const EXPECTED_SHANXI = {
  'ROUTE-001-1': '䧿山',        // pattern A
  'ROUTE-002-1': '華山',        // pattern B
  'ROUTE-003-2': '管涔之山',    // pattern A, with an interposed clause
  'ROUTE-005-1': '薄山',        // pattern B
  'ROUTE-001-2': '南次二經',    // pattern C: fall back to the chapter name
  // … 12 more
}
```

That table exists because chain names come in three grammatical shapes and no single regex handles all of them. Pattern B puts the range name before 之首; pattern A puts it after 曰; pattern C never states it at all and the correct answer is to fall back to the chapter name. Running the three in the wrong order silently produces the wrong chain name for a subset of the 26 chains — a failure mode that is invisible in aggregate statistics and only caught by asserting every case by name.

Two operational details are worth copying. The script imports only `node:fs`, `node:path` and `node:url` at runtime, and its emitted JSON is committed to the repository — which is why the build survives an environment where the source corpus does not exist:

```js
if (!existsSync(MAP_DATA)) {
  console.warn('[build-shanhaijing-data] source corpus absent; skipping rebuild')
  process.exit(0)
}
```

CI checks out the blog repository, not the research corpus. A missing-input hard failure would break every deploy that touches a post; a clean skip with the committed artifact as fallback means the data layer is reproducible where it can be and merely stable where it cannot. One caveat in the interest of accuracy: the script's header comment claims zero dependencies, but the file does import `typescript` to transpile two pure layout modules at build time. That is a build-time-only dependency, not a runtime one, but the comment is stale.

## Why Call It a Subway Map?

Because a subway map is the correct visualisation for a text that encodes topology without geography. 26 lines, 447 stations, 97,358 *li* of claimed track — and no coordinates anywhere in the source.

A subway map deliberately discards real geography and keeps only order, adjacency, and interchange. That is precisely what the *Shanhaijing* provides. Each chain is a line. Each mountain is a station. Each "east three hundred *li*" is an inter-station segment with a distance label. An entity that appears in more than one chapter is an interchange — the same name served by two lines — and there are 241 such names in the disambiguation map.

> **Citation capsule:** The *Shanhaijing* describes 447 mountains across 26 chains with a claimed total of 97,358 *li*, but supplies no coordinates, no dates, and no absolute positions. The knowledge graph therefore encodes topology — chain membership, adjacency, distance, bearing — rather than geography, which is why the visualisation is a metro map rather than a map of China. Source: project structure artifacts, 2026.

The graph is honest about the difference. Positions are computed by walking the chains and accumulating distance, so every coordinate is flagged as estimated rather than surveyed, and the entity layer is split into three confidence bands rather than presented as one uniform dataset. The nine-tailed fox gap and the 63 recorded contradictions belong to the same principle: the graph reports what the text says, including where the text is silent or self-contradictory.

How that graph gets rendered without a charting library — the 26-line metro view, the single-mountain focus view, the precomputed layout that runs at build time rather than in the browser — is [post 4 in this series](/posts/shanhaijing-zero-dependency-visualization/). And if you want the whole picture first, start at the [series hub](/posts/machine-reading-shanhaijing-knowledge-graph/).

## FAQ

### How many entities and relations are in the Shanhaijing knowledge graph?

2,141 canonical entities across 15 populated types, 5,896 spatial relations and 1,217 biology relations, plus 2,117 alias entries and 241 disambiguation records. The graph is emitted as static JSON with no database or query engine behind it (project build artifacts, 2026).

### Are the relations extracted by an LLM?

No. Every relation is produced by a deterministic regex pattern over the annotated corpus. Of 7,113 relations, 7,105 carry `auto: true` from a named `evidence_type`, zero come from LLM inference, and eight were authored by hand — the three disputed identity claims plus five manual aliases (project build artifacts, 2026).

### Why does the annotation schema declare 20 classes if only 15 are populated?

Because five classes — shrine, time, book, tribe and direction-section — have no defensible instances in this corpus, and the tagger is configured to skip rather than guess. The motion-verb class is empty for the same reason. A declared-but-empty class is a design outcome, not a defect (project annotation census, 2026).

### What is a record unit and why not use events?

A record unit is one atomic statement from one sentence — a product list, a creature description, a watercourse, a chain summary. Historical corpora model events with dates and participants, but the *Shanhaijing* has no reliable chronology, so the pipeline extracts 1,041 record units in seven sentence patterns instead (project records index, 2026).

### Why is the total distance 97,358 li when the per-step sums differ?

Because the text's closing summary sentences and its per-step distances do not agree, and the pipeline records the disagreement instead of resolving it. Only 2 of 26 chains reconcile exactly; 17 differ in distance and 6 differ in both distance and mountain count. Those 63 contradictions are the subject of post 2 in this series.

## Conclusion

The engineering claim of this project is narrow and testable: a 32,316-character classical Chinese text can be turned into a 2,141-entity, 7,113-relation knowledge graph with **no LLM inference at extraction time**, by combining a bracket-based annotation layer that cannot break Markdown, a longest-match span tagger that guarantees mutual exclusivity, seven sentence patterns that absorb the text's own formulaic structure, and a build script that refuses to emit data when any of 29 invariants fail.

The parts that matter most are the parts that are missing. Five declared entity classes are empty. The idiom family is defined and never used. The inline disambiguation syntax exists and the corpus relies on the external map instead. One of the book's most famous creatures has no relation because the text never names it. Every one of those gaps is a decision to stay silent rather than guess, and every one is recorded in the data rather than in a footnote.

Start with the [series hub](/posts/machine-reading-shanhaijing-knowledge-graph/) if you want the whole picture, or jump to [the visualisation post](/posts/shanhaijing-zero-dependency-visualization/) to see how 447 stations get drawn. The graph itself is browsable at [findns.cc/shanhaijing](https://findns.cc/shanhaijing).

## Sources

- Project build artifacts, `entity_index.json`, `entity_aliases.json`, `disambiguation_map.json`, `spatial_relations.json`, `biology_relations.json`, `records.json`, retrieved 2026-10-21, https://findns.cc/shanhaijing
- Project pipeline specification, SKILL_03m entity annotation, SKILL_03n bearing and distance disambiguation, SKILL_04g record-unit recognition, SKILL_05f spatial relations, SKILL_05g product and creature relations, retrieved 2026-10-21, https://findns.cc/shanhaijing
- Project build script, `scripts/build-shanhaijing-data.mjs`, retrieved 2026-10-21, https://github.com/findns94/findns94.github.io/blob/hexo/scripts/build-shanhaijing-data.mjs
- Wikisource, 《山海經》 (Guo Pu annotated edition, public domain), retrieved 2026-10-21, https://zh.wikisource.org/wiki/%E5%B1%B1%E6%B5%B7%E7%B6%93
- Wikimedia Commons, Wang Ximeng, *A Thousand Li of Rivers and Mountains* (1113), Palace Museum, Beijing, public domain, retrieved 2026-10-21, https://commons.wikimedia.org/wiki/File:1c_Wang_Ximeng._A_Thousand_Li_of_Rivers_and_Mountains._(51,3x1191,5cm)1113._(section)_Palace_museum,_Beijing.jpg
- Wikimedia Commons, Wu Renchen, 《山海經廣注》 (1667), woodblock illustration of Kui, public domain, retrieved 2026-10-21, https://commons.wikimedia.org/wiki/File:Wu-Renchen-Shanhai-jing-guangzhu-Kui.jpg
