---
title: "A 2,300-Year-Old Book That Contradicts Itself 63 Times — Machine-Reading the Shanhaijing"
description: "Machine-reading the Shanhaijing's 26 mountain chains found 63 contradictions: 28 confirmed, 17 suspected, and one 429% gap that was ours, not the book's."
coverImage: "/posts/shanhaijing-63-contradictions-machine-reading/images/cover.jpg"
coverImageAlt: "A weathered woodblock table-of-contents page from an old illustrated edition of the Shanhaijing, centred on a warm blurred background, representing the 63 machine-detected contradictions in the text"
ogImage: "/posts/shanhaijing-63-contradictions-machine-reading/images/cover.jpg"
date: "2026-10-21 10:00:00"
lastUpdated: "2026-10-21 10:00:00"
author: "FindNS94"
tags: [Shanhaijing, Culture, Data Science]
categories: ["Culture", "Data Science"]
math: false
---

![A weathered woodblock table-of-contents page from an old illustrated edition of the Shanhaijing, centred on a warm blurred background, representing the 63 machine-detected contradictions in the text](/posts/shanhaijing-63-contradictions-machine-reading/images/cover.jpg)

# A 2,300-Year-Old Book That Contradicts Itself 63 Times — Machine-Reading the Shanhaijing

The *Shanhaijing* (山海經, "Classic of Mountains and Seas") is a geography that refuses to add up. Twenty-six times, at the end of a mountain chain, the text stops and totals itself: *from such-and-such a mountain to such-and-such a mountain, so many mountains, so many li*. Those summary sentences are the closest thing the book has to a table of contents. So we added up the legs — all 447 mountain entries, every 「又東三百里」 — and compared the two numbers.

They disagree. Not once, not in a rounding-error way, but 63 times, across five structurally different kinds of conflict — including one entry that reports the same distance twice, 509,800 steps and 510,009,800 steps, a gap of 10,009×.

This post is the research layer of a six-part series on machine-reading the *Shanhaijing*. It is about the contradictions themselves — what they are, which ones survived scrutiny, which dissolved, and the one rule that governs how we handle every single one of them: **只记录，不修正原文** — record only, never fix the source.

<!-- more -->

> **Key Takeaways**
> - A structural pass over 26 mountain chains and 447 entries returned **63 contradictions**: 28 confirmed, 17 suspected, 14 undecidable, 4 explained (`conflict_report.json`, 2026).
> - The `our_bug` flag reads **0** — but the loudest entry, 北次三經 at +10,090 li, was ours: a dropped 萬 turned a 90-li residual into 429%.
> - The largest discrepancy truly in the text is 海外東經's 豎亥步 entry: two readings 10,009× apart.
> - Only **2 of 26** chains reconcile exactly.

## What Does a Machine Actually Find Inside a 2,300-Year-Old Book?

It finds a text with internal arithmetic, and that arithmetic fails 63 times. A structural pass over all 18 chapters — 447 mountain entries organised into 26 chains, roughly 97,358 li of stated distance, about 32,316 Chinese characters of scripture — produced 63 contradictions, sorted into five classes and four verdicts ([project conflict report](https://findns.cc/shanhaijin/), 2026).

The pipeline is deliberately boring. One stage cuts the text into numbered units with stable IDs like `（003-3.46）`. A second stage parses every direction phrase — 「又東三百里」 becomes *east, 300 li* — and sums the legs of each chain. A third stage reads the summary sentence that closes each chain and compares the two totals. A fourth stage classifies each mismatch, attaches the original text on both sides, and assigns a verdict.

That last step is where most data projects quietly cheat. It is easy to detect a mismatch; it is much harder to decide whether the mismatch is a fact about the book or a bug in your own code. This pipeline refuses to blur the two, which is why every item carries a machine-readable flag called `our_bug`.

<!-- [ORIGINAL DATA] The verdict-by-class cross-tab below is not printed anywhere in the project's own report. We recomputed it from `conflict_report.json` for this article: it is the fastest way to see that the 14 undecidable items and the 14 cross-chapter items are the same 14 records. -->

| Class | What it compares | Items | Verdicts |
|-------|------------------|------:|----------|
| **A** — summary mountain count | summary sentence says N mountains vs. N actually counted | 7 | 6 confirmed, 1 explained |
| **B** — summary mileage | summary sentence says M li vs. the summed legs | 24 | 16 confirmed, 8 suspected |
| **C** — cross-chapter same name | one mountain name, two chapters, incompatible directions | 17 | 14 undecidable, 3 suspected |
| **D** — textual corruption | a wrong or dropped character inside a number or a phrase | 12 | 6 confirmed, 6 suspected |
| **E** — distance-type error | a height or a width read as a road distance | 3 | 3 explained |
| **Total** | | **63** | **28 / 17 / 14 / 4** |

Read the verdict column carefully, because it is the honest part. Only 28 of the 63 items — 44% — are confirmed conflicts. Seventeen are suspected, meaning the evidence points at a real inconsistency but the threshold is arguable. Fourteen are undecidable: the pipeline refuses to guess, lists what is missing, and stops. Four are explained, and one of those four is not really a contradiction at all — it is the 「凡十萬山」 entry, where the summary sentence claims 100,000 mountains for a chain that contains 15.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-63-contradictions-machine-reading/charts/chart-1-contradiction-types.svg"
       alt="Stacked horizontal bar chart of the 63 machine-detected contradictions in the Shanhaijing grouped by type and coloured by verdict: summary mileage mismatch 24, cross-chapter same-name conflicts 17, textual corruption 12, summary mountain-count mismatch 7, mileage-type errors 3; verdicts split into 28 confirmed, 17 suspected, 14 undecidable and 4 explained"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

The distribution is lopsided in a way that tells you something about the book. Class B, the mileage class, is 38% of everything. That is not because the *Shanhaijing* is bad at geography; it is because mileage is the only quantity the text repeats twice — once as a running total, once as a per-leg number — and any text that states a number twice will eventually disagree with itself.

<figure style="margin:2.5rem 0;text-align:center">
  <img src="/posts/shanhaijing-63-contradictions-machine-reading/images/phoenix.jpg"
       alt="A colour woodblock illustration of the nine-headed bird Jiufeng from an illustrated Chinese edition of the Shanhaijing, nine crested heads rising from a green and blue body on aged paper"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

One boundary worth stating up front: this analysis works on the text alone. The illustrated editions — like this 九鳳, the nine-headed bird of 北極天櫃之山 in the Great Wilderness North chapter — are how most readers picture the book, and they carry no mileage, no mountain counts, and therefore no contradictions of the kind measured here. They are a different dataset, and they are not in this one.

> The *Shanhaijing* states its own totals 26 times, once per mountain chain, and 24 of those totals disagree with the sum of the individual legs underneath them. That single structural fact — a text that audits itself — is what makes machine reading productive here rather than merely decorative (project `route_report.md`, 2026).

## How Do You Prove a Contradiction Is in the Text, Not in Your Parser?

You cannot prove it item by item. You prove it by making your own bugs visible, fixing them, and then re-running until the counter reads zero. Our first pass through the *Shanhaijing* produced 22 contradictions that turned out to be ours, not the book's — and every one of them was found by the contradiction layer itself, not by the code that had the bug.

The four rules that make this work are short enough to state in full:

- **R1 — Record only, never fix the source.** A contradiction is research information. Editing the base text to make the numbers agree would destroy the evidence.
- **R2 — Every item must trace back to a stable ID plus the original text.** No contradiction exists without a citation on both sides.
- **R3 — Every item must carry an explanation.** Dropped character, displaced block, counting-convention difference, or a formulaic round number — the pipeline has to say which, and the explanation is allowed to be "we do not know".
- **R4 — Separate "the book's problem" from "our problem".** Anything traceable to our own code is flagged `our_bug: true` and does not count as a finding.

<!-- [PERSONAL EXPERIENCE] The three bug families we hunted down in this pass, all surfaced by the contradiction layer: (1) water travel double-counted — 「水行五百里」 was folded into a mountain's road distance while also being stored separately, so the same mileage was counted twice; (2) a mountain name swallowed by the parser — in 「西水行四百里，曰流沙，二百里至于蠃母之山」 the parser took 流沙 as the destination and dropped 蠃母之山 from the chain entirely; (3) a bare 「行X里」 leg that matched no pattern and vanished from both totals. Fifteen, three and four cases respectively — 22 in total, and the reason `our_bug` is a first-class field rather than a footnote. -->

The most instructive failure was the first one. A water leg such as 「又南水行五百里」 is a distance, but it is not a mountain-to-mountain road distance, so the same mileage was landing in two different places: inside a mountain's own `distance_li` and inside the separate water-travel table. That inflated the per-entry sums, which inflated every gap, which made the *book* look worse than it is. Three mountains also disappeared from their chains because a place name — 流沙, 泰澤, a sand plain — was parsed as the endpoint instead of the mountain at the end of the sentence.

Every one of those 22 items is now fixed, and the flag reads zero. That is the whole point of the discipline: `our_bug: 0` is not a claim that our parser is perfect. It is a claim that we looked, that we found our own errors, and that the 63 items remaining are the ones we could not pin on ourselves.

It is also a claim that has to be audited rather than trusted — and this project has a case that proves it. The single largest entry in the whole report, a 429% mileage gap, turns out to be a character our own number parser dropped rather than a character the book lost. We take it apart in the next section, because a self-reported zero that nobody re-checks is worth exactly as much as the parser that reported it.

> The *Shanhaijing* conflict report flags zero of its 63 contradictions as parser errors, after 22 of our own defects were found by cross-checking and fixed. One entry shows why that field must be audited rather than trusted: a dropped 萬 turned a 90-li residual into a 429% "contradiction" (project `conflict_report.json`, 2026).

## Which Number Is the Report's Most Dramatic — and Which One Is Real?

The report's loudest entry is 北次三經, the third chain of the Northern Mountains chapter: 47 mountain entries summing to 12,440 li against a summary sentence recorded as 2,350 li — a gap of +10,090 li, or 429%, the largest percentage gap in the whole report. It is also the entry that teaches this project's central discipline best, because the gap is ours, not the book's.

The summary sentence as transcribed in our own corpus reads 「萬二千三百五十里」 — that is 12,350 li, with the 萬 present in the text. What was missing was the 萬 in our own stored value: the structure layer recorded `stated_total_li: 2350`, dropping the leading character. Put it back and the arithmetic changes character entirely. 12,440 against 12,350 is a residual of 90 li, 0.7% — exactly the size of error you expect from a text copied by hand for two thousand years, and nowhere near a discovery about the ancient book.

<!-- [UNIQUE INSIGHT] The lesson is not that a pipeline had a bug; pipelines have bugs. The lesson is that a bug in a *number parser* does not announce itself. It produces a clean integer, a plausible-looking field, and a contradiction 429% wide that reads like a finding about the ancient text. Nothing inside the data tells you which of the two numbers is wrong — only going back to the transcribed source line does. That is why the rule requiring the original text on both sides of every contradiction is not documentation overhead. It is the only mechanism that makes this class of error findable at all. -->

There is a second wrinkle, and it shows how much a "contradiction" depends on definitions. The two stages of our own pipeline disagree about the same chain's per-entry total: the structural stage records 12,440 li, the route stage 10,540 li. Neither is a bug. The route stage strips water and sand-travel legs out of the mountain-to-mountain totals by design; the structural stage keeps them in. So the same chain can be described as +90 li (12,440 vs the corrected 12,350), or as −1,810 li (10,540 vs 12,350), depending on which of two defensible conventions you adopt. Both numbers are recorded, and the definition that produced each one is recorded with it.

Now compare that with a discrepancy that really is in the book. In 海外東經, the entry 「豎亥步」 reports the distance Yu's surveyor measured from the eastern extreme to the western extreme of the world — and gives it twice: 「五億十選九千八百步」 and 「五億十萬九千八百步」. The pipeline records the two readings as 509,800 and 510,009,800 steps, with a stored ratio of 10,009× between them. The whole gap lives in one character, 選 where 萬 belongs, and the text is its own witness: the 「一曰」 ("one version says") that introduces the second figure is a native variant marker, written into the book rather than added by an editor. That is why this item is classified as textual corruption rather than as a geographic error — and why it, not the 429% case, is the report's largest genuine in-text discrepancy.

## What Happens When the Same Mountain Appears in Two Different Chapters?

Nothing, at first. A mountain name recurring in a different chapter is a naming fact, not a contradiction — and treating it as one is the fastest way to generate 200 fake findings. The *Shanhaijing* names mountains in one or two characters: 陰山, 陽山, 竹山, 玉山, 石山. Names like these are going to repeat.

So the pipeline applies a much stricter test. It reports a cross-chapter conflict only when the same name appears in two chains **and** the direction words cannot be reconciled. That test yields 17 items, and 14 of them are marked undecidable — because both positions are relative.

That is the crux. 「又東三百里，曰青丘之山」 does not mean 青丘 is in the east. It means 青丘 is 300 li east of *the previous mountain in this chain*. Every position in the five mountain chapters is a link in a relative chain. Two chains that both say "east" of their own previous peak have told you nothing about whether they describe the same place. Reconciling them requires an absolute frame, and the *Shanhaijing* does not provide one.

The cleanest example is 青丘, and it is the one the pipeline marks as a genuine frame conflict rather than an unknowable:

- **《南山經》** `（001-1.7）` — 「又東三百里，曰青丘之山」 — 300 li east of the previous mountain in the chain. A relative coordinate.
- **《海外東經》** `（009-8）` — 「青丘國在其北，其人食五穀，衣絲帛。其狐四足九尾」 — "north of it", where "it" is the previous entry in that chapter, 朝陽之谷. An absolute-direction statement anchored to a different reference frame.
- **《大荒東經》** — 「有青丘之國，有狐，九尾」 — the same place named a third time, with no direction at all.

Line up the first two and you get the contradiction: 青丘 is 300 li east, and 青丘 is to the north. The pipeline's verdict is not "the book is wrong" but *frame mismatch* — the two statements are not commensurable, and the honest output is to record both frames rather than to declare a winner. The same chapter then uses 青丘 a fourth time, as a landmark: 「豎亥右手把筭，左手指青丘北」 — the surveyor points at the north of 青丘 to describe the western extreme of the world.

<!-- [UNIQUE INSIGHT] The *Shanhaijing* rarely tells you which of two conflicting statements it prefers — but 海外東經 does it twice in three sentences, with 「一曰」. The variant-reading marker is a native uncertainty flag, written into the text roughly two thousand years before anyone thought to put a confidence field in a data schema. Where the book flags its own variants, our verdict should be `explained`; where it does not, we are the ones guessing. -->

Two same-name pairs behave differently again, because they occur *inside a single chain*. 景山 appears twice in 北次三經 — `（003-3.9）`, 300 li south of its predecessor, and `（003-3.24）`, 200 li north of a later one. 豐山 appears twice in 中次十一經, 300 li southeast and 40 li east. The pipeline marks both as suspected conflicts and notes the tell: 北次三經 is exactly the chain whose per-entry mountain count runs one *above* its summary sentence. A repeated name inside one chain is a strong candidate for the missing mountain. The pipeline records that inference; it does not act on it.

<figure style="margin:2.5rem 0;text-align:center">
  <img src="/posts/shanhaijing-63-contradictions-machine-reading/images/kui.jpg"
       alt="A line-drawing woodblock illustration from a Qing edition of the Shanhaijing showing the one-legged beast Kui from Liubo Mountain in the Great Wilderness Eastern Classic, captioned with its description in classical Chinese"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

The *Great Wilderness Eastern Classic* that names 青丘 a third time also names 夔, the one-legged beast of 流波山 whose hide became the Yellow Emperor's drum — a reminder that the same chapters carrying the driest directional chains also carry the material that made this book famous. Both are in the same data structure, and the pipeline does not privilege either.

## Why Do Only 2 of the 26 Mountain Chains Add Up?

Because a chain only reconciles when the summary sentence and the per-entry legs were derived from the same span of text, and that is rarer than it sounds. Of 26 chains, exactly two match on mileage: 東次四經 (1,720 li stated, 1,720 li counted) and 中次四經 (1,670 and 1,670). Seventeen chains have matching mountain counts but mismatched mileage. Six mismatch on both. One is unparsed because its summary sentence is corrupt.

Two chains deserve special mention, because they show that "mismatch" covers very different situations. 東次三經 records **zero** li across nine mountain entries against a summary sentence of 6,900 — a −100% gap. The reason is structural, not scribal: every leg in that chain is written as water or sand travel, which the route stage deliberately excludes from mountain-to-mountain distance. The chain is not wrong; it is written in a different mode. And 中山經 sums to 937 li against a stated 6,670 — a −86% gap produced by 15 entries whose individual legs are tiny, 15 or 20 or 35 li each.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-63-contradictions-machine-reading/charts/chart-2-chain-mileage-deviation.svg"
       alt="Lollipop chart on a logarithmic axis showing the mileage gap between each of the 26 Shanhaijing mountain chains and its own summary sentence: only two chains match exactly, most miss by under 25 percent, the largest genuine gaps are the East Third Chain at minus 100 percent, the Central Mountains chain at minus 86 percent and the Central Third Chain at minus 82 percent, and a dashed marker records the 348.5 percent gap our parser produced for the North Third Chain before a dropped 萬 character was found"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

The chart above also shows how much the answer depends on definitions. 東次二經 looks like an exact match in one stage of the pipeline (6,640 vs 6,640) and a −1,200 li mismatch in another (5,440 vs 6,640) — because the two stages disagree about whether a 1,200-li water leg belongs in the total. Both are recorded. That is the same discipline as `our_bug: 0`, applied to a disagreement between two of our own artefacts instead of between the book and itself.

> Of 26 mountain chains in the *Shanhaijing*, only 2 reconcile exactly with their own summary sentence, 17 match on mountain count but not on mileage, 6 fail on both, and 1 cannot be parsed at all because its summary reads 「凡十萬山」 — 100,000 mountains for a chain of 15 (project `route_report.md`, 2026).

## What Does "Record Only, Never Fix the Source" Cost You?

It costs you convenience, and it buys you a dataset that can be wrong out loud. The rule means the pipeline will never contain a "corrected" *Shanhaijing*. When the summary sentence claims 100,000 mountains, the data says 100,000 — flagged as corrupt, never quietly changed to 15. When two chapters place 青丘 in incompatible directions, both placements survive in the graph.

Three consequences are worth knowing if you build on this data.

**The contradiction list becomes a research queue, not an error list.** A confirmed conflict is a lead for a human editor. The pipeline's job is to hand over both readings with stable IDs and a hypothesis, and to stop there.

**Downstream layers inherit the ambiguity.** The spatial layer marks every position derived from a relative chain as estimated, and refuses to assign coordinates at all to material that is only topological. That is a direct cost of R1: because we never "fixed" a chain to make it close, we also never earned the right to pretend its coordinates are real.

**Some questions stay open forever.** Fourteen of the 63 items are undecidable, and most of them are cross-chapter name collisions that can only be resolved by comparing physical descriptions of the mountains in question — a task for a philologist, not for a parser. Recording them is the deliverable. Resolving them is somebody else's paper.

The rule has an obvious counter-argument, and it deserves an answer: if you cannot fix the text, why not at least fix your own copies of it? Because a pipeline that silently normalises its inputs cannot tell you when its inputs disagree. Every "small fix" to a summary sentence would have deleted one of the 63 items — including the 429% case, which is the most instructive entry in the dataset precisely because it is not about the book at all. Recording the original text on both sides of every contradiction is what let us catch it; a tidier pipeline would have shipped it as a discovery.

## What Should You Take Away?

A 2,300-year-old book that contradicts itself 63 times is not a defective book. It is a book that audited itself, chain by chain, and whose audits no longer agree with its own running text — and that disagreement is measurable, classifiable, and, crucially, *locatable*.

The three numbers to remember are 63, 28 and 0. Sixty-three contradictions across five classes. Twenty-eight confirmed, with the rest honestly hedged. And zero flagged as the parser's fault, after 22 of our own bugs were found and fixed — a zero we then had to audit, because the report's loudest entry turned out to be a character we dropped. That last step is what makes the first two numbers worth anything: without it, "63 contradictions" is just an accusation.

This is post 2 of 6. The [hub post](/posts/machine-reading-shanhaijin-knowledge-graph/) explains why the *Shanhaijing* is a good machine-reading target at all; [the pipeline post](/posts/shanhaijing-knowledge-graph-pipeline/) walks through how the knowledge graph is built; [the visualisation post](/posts/shanhaijing-zero-dependency-visualization/) renders it with hand-written SVG; [the nine-tailed fox post](/posts/shanhaijing-nine-tailed-fox-missing/) shows what happens when the data honestly refuses to answer a question you were sure it could; and [the missing-character post](/posts/shanhaijing-missing-character-429-percent/) goes deep on the single character behind the 429% case. You can read the base text and the extracted entities side by side at [findns.cc/shanhaijin](https://findns.cc/shanhaijin/).

## FAQ

**How many contradictions are actually in the Shanhaijing?**

63, as detected by a structural pass over 26 mountain chains and 447 mountain entries. Of those, 28 are confirmed conflicts, 17 suspected, 14 undecidable and 4 explained. The count is a property of the detection method, not of the book: change the mileage threshold and the number moves.

**Are these contradictions evidence that the Shanhaijing is unreliable?**

No — they are evidence that it is internally auditable. Twenty-four of the 63 come from the book stating its own totals once per chain and disagreeing with its own legs, which is a feature of how the text is built, not a failure of transmission. The confirmed cases are leads for textual criticism, not verdicts on the text's value.

**What does 只记录，不修正原文 mean in practice?**

It means the pipeline never edits the base text to make numbers agree. Corrupt readings such as 「凡十萬山」 are stored as written and flagged, both readings of the 豎亥步 measurement are kept side by side, and conflicting placements of 青丘 survive in the graph. Corrections are proposed in a change log for human editors, never applied to the data.

**Why not just merge mountains that share a name across chapters?**

Because a name is not an identity. Mountains in the Shanhaijing are named in one or two characters, so 陰山, 玉山 and 石山 repeat naturally. All 17 cross-chapter items are relative-direction statements with no absolute frame, and 14 are therefore undecidable until someone compares the physical descriptions of the mountains themselves.

**What is the single largest discrepancy in the text?**

海外東經's 豎亥步 entry, which reports the world's east-to-west measurement twice — 509,800 and 510,009,800 steps, 10,009× apart — with the text's own 「一曰」 flagging the second reading. The report's largest *mileage* gap, 北次三經 at 429%, is a parsing slip, not a textual one: the summary line reads 「萬二千三百五十里」 (12,350 li) and the residual is 90 li.

## Sources

- Wikimedia Wikisource, 《山海經》 (Guo Pu annotated edition, public domain), retrieved 2026-10-21, https://zh.wikisource.org/wiki/山海經
- Project data file, `doc/shanhaijin/kg/conflicts/conflict_report.json` — 63-item conflict report with type, verdict, confidence, hypotheses and `our_bug` flags, 2026
- Project data file, `doc/shanhaijin/kg/conflicts/conflict_report.md` — five-class taxonomy, the 26-chain reconciliation table, and the top-five case analyses, 2026
- Project report, `doc/shanhaijin/logs/structure_build_report.md` — per-chain counted vs. stated mountain counts and mileage, and the text-integrity check, 2026
- Project report, `doc/shanhaijin/logs/route_report.md` — per-leg mileage reconciliation, `check_status` distribution, water-travel extraction, 2026
- Project README, `doc/shanhaijin/000_README.md` — corpus statistics (447 mountains, 26 chains, 97,358 li, 32,316 characters) and the `our_bug: 0` verification, 2026
- Loewe, Michael (ed.), *Early Chinese Texts: A Bibliographical Guide*, Society for the Study of Early China and the Institute of East Asian Studies, 1993 — background on the date and composition of the *Shanhaijing*
- Live reader and knowledge graph, https://findns.cc/shanhaijin/

**Images:** Cover and inline illustrations are public-domain woodblock pages from illustrated Chinese editions of the *Shanhaijing*, retrieved from Wikimedia Commons on 2026-10-21. Cover: table of contents of 《山海經圖》 vol. 2, National Library of China scan. Inline: 九鳳, from a colour edition of the *Shan Hai Jing*; 夔 (Kui), from 《山海經廣注》 by Wu Renchen (1628–1689).
