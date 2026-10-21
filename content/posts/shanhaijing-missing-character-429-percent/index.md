---
title: "The Parser Bug That Looked Like a 2,300-Year-Old Typo — Auditing a Shanhaijing Knowledge Graph"
description: "A 429% distance gap in the Shanhaijing looked like a dropped 萬. It was the parser: the source reads 12,350 li, the pipeline logged 2,350 (project KG, 2026)."
coverImage: "/posts/shanhaijing-missing-character-429-percent/images/cover.jpg"
coverImageAlt: "A dark editorial cover showing a classical Chinese text laid out in vertical columns with one character slot left as an empty amber box, labelled 萬 (ten thousand), beside the headline One Missing Character and a 429% error"
ogImage: "/posts/shanhaijing-missing-character-429-percent/images/cover.jpg"
date: "2026-10-21 10:00:00"
lastUpdated: "2026-10-21 10:00:00"
author: "FindNS94"
tags: [Shanhaijing, Culture, Data Science]
---

![A dark editorial cover showing a classical Chinese text laid out in vertical columns with one character slot left as an empty amber box, labelled 萬 (ten thousand), beside the headline One Missing Character and a 429% error](/posts/shanhaijing-missing-character-429-percent/images/cover.jpg)

For four months, the most interesting number in my *Shanhaijing* project was 429%.

The North Third Chain of the Northern Mountains (北次三經) lists 47 mountains. Add up the "three hundred li further north" phrases between them and you get 12,440 li of travel. But the chain's own summary sentence — the line that closes the chain and tells you what you have just walked — declares 2,350 li. The gap is 10,090 li, or 429% of the declared total. Most other chains in the book land within a few hundred li of their own summary. This one was off by a factor of five.

The explanation was beautiful. Chinese numerals are positional in blocks of ten thousand: 萬二千三百五十 is 12,350, and 二千三百五十 is 2,350. A single dropped 萬 separates them. Put it back and the declared figure becomes 12,350 — landing 90 li from the counted 12,440, a 0.7% residual, which sits well inside the band occupied by most of the other 25 chains. One missing character, one 429% error. The project wrote that hypothesis into its own README and shipped it.

Then I opened the source text. The 萬 is there. Line 186 of the Guo Pu edition reads 凡四十六山，**萬二千三百五十里**. The character had been dropped — by my own numeral parser, which multiplied a leading 萬 by zero and wrote 2,350 into the knowledge graph. The 429% was not a 2,300-year-old typo. It was a bug in a file I wrote myself.

This post is the audit that followed: how a plausible textual-criticism hypothesis survived four pipeline layers without anyone re-reading the line it was about, what the *Shanhaijing*'s one genuine same-sentence number contradiction actually looks like, and what "record, don't fix" is really for.

<!-- more -->

> **Key Takeaways**
> - The North Third Chain tallies 12,440 li against a summary sentence declaring 2,350 li — a +10,090 li gap, or 429%, the largest in the book ([project data](https://findns.cc/shanhaijing), 2026).
> - The gap was a numeral-parser bug that dropped a leading 萬. The 2,300-year-old manuscript reads 萬二千三百五十里 = 12,350 li, so the real residue is 90 li, or 0.7%.
> - Two pipeline layers parse the same string differently — the structure layer logs 2,350 li, the record layer logs 12,350 li — and both numbers ship in the published data.
> - The project's one genuine same-sentence numeric contradiction is the 豎亥 survey in the Overseas East chapter, where 一曰 ("another account says") preserves 509,800 and 510,009,800 steps for the same walk.

## What Was the 429% Shanhaijing Mileage Gap?

It was the distance between a tally and a summary inside a single chain. The *Wuzang Shan Jing* (五藏山经) is 26 mountain chains covering 447 mountains and a declared 97,358 li, drawn from a base text of 32,316 characters ([project data](https://findns.cc/shanhaijing), 2026). Each chain ends with a summary sentence of the form 凡N山，M里 — "altogether N mountains, M li." The North Third Chain is the outlier: 47 parsed entries summing to 12,440 li against a declared 2,350 li, a gap of +10,090 li, or 429% ([project conflict report](https://findns.cc/shanhaijing), 2026).

Nothing else in the book is close. On the structure layer's tally, the other 25 chains miss their own summaries by a median of 190 li, and only one misses by more than 1,000 ([project data](https://findns.cc/shanhaijing), 2026). A 429% gap is not rounding. It is either a catastrophe in the manuscript or a catastrophe in the code, and from the output side those two possibilities look identical.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-missing-character-429-percent/charts/chart-1-declared-vs-counted-distance.svg"
       alt="Dumbbell chart of declared versus counted distance for all 26 Shanhaijing mountain chains. Twenty-five rows are short, showing small discrepancies of a few hundred li. The North Third Chain of the Northern Mountains is the single outlier: 12,440 li counted against a declared 2,350 li, a gap of 10,090 li or 429 percent. An amber hollow marker on that row shows 12,350 li, the value the source text spells out, which would leave a gap of only 90 li."
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

## Why Did the Project Report Two Different Gaps for the Same Chain?

Because two counting conventions are defensible, and the project runs both. The structure layer sums every distance phrase it finds, including water-course and sand-travel segments, and reports 12,440 li counted versus 2,350 li declared — a gap of +10,090 li, or 429% ([structure build report](https://findns.cc/shanhaijing), 2026). The route layer deliberately excludes water-course mileage from its stop list, because a boat journey is not a mountain-to-mountain distance, and reports 10,540 li counted versus the same 2,350 li declared — a gap of +8,190 li, or 348.5% ([conflict report](https://findns.cc/shanhaijing), 2026).

The difference between the two tallies is exactly 1,900 li: the water-course and travel segments inside the chain that the route layer sets aside. Both conventions appear in the same repository, applied to the same sentence, and neither is wrong on its own terms. What is wrong is that a reader has no way to tell which number they are looking at without opening two JSON files.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-missing-character-429-percent/charts/chart-2-four-readings-one-sentence.svg"
       alt="Horizontal bar chart of four numbers reported for the same summary sentence of the North Third Chain: 12,440 li counted with water-course mileage included, 12,350 li as the source text spells it, 10,540 li counted with water-course mileage excluded, and 2,350 li as recorded by the structure layer's numeral parser. The top two differ by 90 li, or 0.7 percent; the bottom value is an artefact of parsing."
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

## Where Did the "Dropped 萬" Hypothesis Come From?

From the arithmetic, which is exactly the problem. If the declared figure is 2,350 and the counted figure is 12,440, then the difference is 10,090, and 10,090 is very nearly 10,000. A dropped 萬 is the cheapest explanation that fits: restore it and you get 12,350, which sits 90 li from 12,440 — a 0.7% residual, well inside the noise of the other chains. The hypothesis was recorded in the project README as the academic explanation, and it is a good hypothesis. It is also unfalsified only because nobody re-read the sentence it was about.

The conflict report, meanwhile, rejected the same hypothesis. Working from the water-excluded tally of 10,540 li, restoring a 萬 gives 12,350, which overshoots by 1,810 li. The report's own inference reads: "「萬」字脱漏假设不成立（补「萬」后差 -1,810 里）" — the dropped-萬 hypothesis does not hold ([conflict report](https://findns.cc/shanhaijing), 2026). So the same project simultaneously asserts the hypothesis and rejects it, in two files, using two tallies of the same chain.

<!-- [UNIQUE INSIGHT] Both verdicts are artefacts of the same missing step. The conflict report compared a route-layer tally (10,540 li, water excluded) against a structure-layer declared value (2,350 li, parser-mangled). Neither file recorded which layer produced which number, so the comparison was never apples to apples. Provenance, not arithmetic, was the failure. -->

## What Happens When You Check the Source Text?

The character is present, and it is not ambiguous. The base text for the project is Guo Pu's fourth-century annotated edition on Wikisource, and the summary node (003-3.47) of the North Third Chain reads:

> 凡《北次三經》之首，自太行之山以至于無逢之山，凡四十六山，**萬二千三百五十里**。

That is 12,350 li, written with 萬. No restoration is required. The 2,350 in the knowledge graph was produced by `cn2int()`, the numeral parser inside `build_structure_data.py`, whose ten-thousand branch reads `section = (section + num) * 10000`. When 萬 is the first character of a number, `num` is still 0, so the parser computes 0 × 10000 and silently discards the entire ten-thousand block. Feed it 萬二千三百五十 and it returns 2350. Feed it 二萬三千二百三十 — the chapter's own closing total, which begins with 二 — and it returns 23230, correctly.

<!-- [PERSONAL EXPERIENCE] I found this by running the two parsers side by side on the same string. The structure layer's local copy returned 2350. The shared `cn2int.py` used by the later route and record layers returned 12350, because its ten-thousand branch reads `section = (section + (number or 1)) * unit` — the `or 1` is the whole difference. Two files, thirty lines apart in logic, one character apart in behaviour. -->

The later layers never inherited the bug. The record layer, which extracts the summary sentences as structured "record units", parsed the same string correctly: `records.json` stores `stated_total.li: 12350` with `li_raw: 萬二千三百五十` for record `003-213` ([project record units](https://findns.cc/shanhaijing), 2026). So the project has held both readings since the day the record layer was built — 2,350 in `chain_summaries.json` and `route_index.json`, 12,350 in `records.json` — and no lint rule compared them.

## How Did One Dropped Character Become a 429% Error?

By compounding silently at every layer that copied the number. The parser wrote 2,350 into `chain_summaries.json`. The route builder read the declared value from there and stored `stated_total_li: 2350` in `ROUTE-003-3.json` and `route_index.json`. The conflict detector read the route file for the counted value and the chain summary for the declared value, and computed a difference of 8,190. The structure report used its own counted total and computed 10,090. The README quoted the 429% figure, and the series outline quoted the README.

Every one of those steps is arithmetically correct. None of them re-read the sentence. That is the whole failure mode: a derived number, once written, becomes a fact, and derived facts are quoted far more often than they are verified. The 429% figure is now the headline discrepancy of the entire project — it leads the conflict report's severity ranking and it opens this six-post series — and it is wrong.

## Why Is It Dangerous for a Pipeline to Confuse Its Own Bugs With the Text's Problems?

Because the confusion is invisible in the output and authoritative in the citation. The project's conflict report records 63 contradictions across five categories and assigns every one of them `our_bug: false` — a deliberate claim that all 63 are properties of the *Shanhaijing* and none are parsing failures ([conflict report](https://findns.cc/shanhaijing), 2026). The 429% gap was never classified as corruption; it sits in the mileage category, with a corruption hypothesis attached in prose. The twelve entries that *are* classified as corruption are all genuine properties of the text, which makes the prose hypothesis the weak link rather than the classifier.

The stakes are not academic tidiness. A knowledge graph is a citation surface. An LLM asked "what is the largest internal contradiction in the *Shanhaijing*?" will read a report that says 429% and will repeat it, with a source, confidently. A reader who then goes looking for scholarship on a lost 萬 will find none, because there is nothing to find. The pipeline has not just made an error; it has manufactured evidence for a textual corruption that does not exist, and stamped it with a provenance trail.

<!-- [UNIQUE INSIGHT] This is why the `our_bug` field matters more than the conflict count. A pipeline that reports "63 contradictions, 0 of them mine" is not making a neutral statement — it is making a claim about the manuscript. When that claim is wrong, the error does not stay inside the project. It propagates into every downstream summary, including the ones written by language models. -->

## What Is the Shanhaijing's One Genuine Same-Sentence Number Contradiction?

The 豎亥 survey in the Overseas East chapter (海外東經), where the text itself carries both readings. The passage describes the god's measurement of the world:

> 帝命豎亥步，自東極至于西極，五億十選九千八百步。豎亥右手把筭，左手指青丘北。一曰禹令豎亥。**一曰五億十萬九千八百步**。

The first reading gives 五億十選九千八百步; the second, introduced by 一曰 — "another account says" — gives 五億十萬九千八百步. The difference is a single character, 選 against 萬, and the two are close enough in sound and shape to be a textbook 形近/音近 corruption. The project's conflict record assigns 509,800 to the first reading and 510,009,800 to the second and labels the divergence 10,009× ([conflict report](https://findns.cc/shanhaijing), 2026).

This is the case the 429% story was imitating, and the difference between them is decisive. Here the variant is *in the text*: 一曰 is a scribal marker that says "the manuscripts disagree," so the corruption is documented by the tradition rather than inferred by the machine. There is no parser involved, no derived number, and no hypothesis — just a sentence that contradicts itself, 2,300 years old and still visible on the page.

<!-- [ORIGINAL DATA] The 豎亥 entry's own error metric does not survive a calculator. The recorded values are 509,800 and 510,009,800 steps, and 510,009,800 ÷ 509,800 ≈ 1,000×, not the 10,009× stored in the record's `evidence.ratio` field (the report's prose says 10,000×). I quote the project's figure as the project records it, and I quote the discrepancy too, because that is the entire lesson of this post: audit the derived number, not the headline. -->

## How Does This Connect to Classical Textual Criticism (校勘学)?

Directly — the pipeline is reimplementing 校勘学 with worse vocabulary. Chinese textual criticism has named these failure modes for two thousand years: 讹文 (*éwén*) for a corrupted character, 脱文 (*tuōwén*) for an omitted one, 衍文 (*yǎnwén*) for an interpolated one, 异文 (*yìwén*) for a surviving variant reading. The dropped 萬 that never happened would have been 脱文. The 選/萬 pair in the 豎亥 passage is 讹文 with a 异文 as its witness.

Classical practice also prescribes the method. 对校 compares against other editions; 本校 compares a passage against the rest of the same book; 他校 compares against other books; 理校 reasons from internal plausibility when no witness survives. The pipeline's chain-summary reconciliation is 本校 performed exhaustively — every one of the 26 summaries checked against its own entries, which no human reader has ever done. Its numeral parser is 理校 implemented as a regular expression. The discipline it lacks is the one that matters most: 存疑, the willingness to leave a reading unresolved until a witness appears.

## What Does "Record, Don't Fix" Actually Protect?

It protects the evidence from the tooling. The project's first hard rule is 只记录，不修正原文 — record, never correct the source. The pipeline writes an annotated copy of every chapter, but the base text in `origin/` is never edited, and an integrity lint verifies that all 18 chapter files match it character for character, with zero substantive differences ([structure build report](https://findns.cc/shanhaijing), 2026). No emendation, not even a confident one, is ever written back.

The rule exists because the *Shanhaijing*'s contradictions are the most valuable thing in it. The 十萬 mountain count in the Central Mountains chain, the 苟牀/苟林 variant, the 46-versus-47 mountain tally — these are the traces of a text that was copied by hand for two millennia, and normalising them would destroy exactly the signal a philologist wants. What this post adds is the corollary the project had not written down: if you refuse to fix the source, you inherit a much heavier obligation to know when the anomaly is yours. "Record, don't fix" is only honest if "record" includes recording your own failures.

## How Do You Audit a Machine-Reading Pipeline?

Reconcile every derived number against the string it came from, and treat disagreement between layers as a bug until proven otherwise. The specific checks that would have caught this one are cheap and general:

1. **Round-trip every numeral.** Parse each number, render it back to Chinese, and compare. 萬二千三百五十 → 12350 → 一萬二千三百五十 would have failed immediately.
2. **Test the parser on leading-unit forms.** 萬二千三百五十, 十萬, 萬, 億. A parser that handles 二萬三千二百三十 correctly can still fail 萬二千三百五十, and only the leading-unit cases expose it.
3. **Compare layers on shared fields.** The structure layer and the record layer both store the declared total for all 26 chains. A one-line lint asserting equality would have flagged this on the day the record layer was built.
4. **Store provenance with every number.** Which file produced it, from which PN, by which function. The conflict report's two tallies were not contradictory; they were incomparable, and nothing said so.
5. **Never let a derived value become a source.** The README's 429% was quoted from a report, which was computed from a JSON, which was written by a function. Four hops from the sentence.

<!-- [ORIGINAL DATA] Re-run with the parser fixed, the North Third Chain stops being the worst contradiction in the book. Counted 12,440 li against a declared 12,350 li is +90 li, or 0.7%. The chapter-level check agrees: the Northern Mountains chapter's three chains tally 23,360 li against a chapter total of 23,230 li, a +130 li residual, or 0.6%. With water-course mileage excluded the same chain sits at 10,540 li, or −1,810 li against the source spelling. One convention reconciles to within a rounding error; the other does not, and now you can see which is which. -->

## What Does This Change About the 429% Headline?

It removes it, and replaces it with a smaller number and a much better question. The North Third Chain's genuine residual is 90 li — 0.7% of the declared total, squarely inside the band occupied by the other 25 chains. What remains genuinely unresolved is the mountain count: the chain lists 47 entries against a declared 46, and the discrepancy traces to a two-level place name at the head of the chain, 太行之山。其首曰歸山, where one line may name either one mountain or two ([structure build report](https://findns.cc/shanhaijing), 2026).

That is a real 校勘 question, of exactly the kind the project exists to surface, and it is a one-mountain question rather than a 10,090-li one. The lesson is not that machine reading failed. The machine found the anomaly, ranked it correctly as the largest in the book, and preserved every number needed to diagnose it — including, eventually, the number that proved the diagnosis wrong. What it could not do was notice that the anomaly was its own.

## Frequently Asked Questions

### Did the Shanhaijing really lose a character?

No. The summary sentence of the North Third Chain reads 萬二千三百五十里 in the Guo Pu edition on Wikisource — 12,350 li, with the 萬 present. The 2,350 recorded in the knowledge graph was produced by a numeral parser that discarded a leading 萬, so the dropped character was in the software, not in the manuscript ([project data](https://findns.cc/shanhaijing), 2026).

### How large is the North Third Chain discrepancy, really?

It depends on the counting convention, and now the conventions are legible. Counting every distance phrase gives 12,440 li against a declared 12,350 li — a 90 li residual, or 0.7%. Excluding water-course and travel segments gives 10,540 li, or 1,810 li short of the source spelling. The 47-versus-46 mountain count remains an open question.

### Why did two layers of the same pipeline disagree about one number?

Because they used two different numeral parsers. The structure layer has its own `cn2int()` whose ten-thousand branch multiplies a leading 萬 by zero and returns 2,350; the shared `cn2int.py` used by the route and record layers handles the missing leading digit and returns 12,350. The record layer has stored the correct value since the day it was built.

### Is the 豎亥 step count a real textual corruption?

Yes. The Overseas East chapter gives 五億十選九千八百步 and, in a 一曰 variant clause, 五億十萬九千八百步 — the same measurement recorded twice, differing by one character. The project records 509,800 and 510,009,800 steps for the two readings and flags the divergence as a genuine same-sentence contradiction ([conflict report](https://findns.cc/shanhaijing), 2026).

### How many contradictions did the project record, and how many were its own bugs?

Sixty-three, across five categories, with every entry marked `our_bug: false` — a claim that none were parsing failures ([conflict report](https://findns.cc/shanhaijing), 2026). The North Third Chain mileage gap should have been the exception. It was the largest recorded contradiction in the project and it belonged to the code, not the text.

## Conclusion

The seductive version of this story is that the *Shanhaijing* lost a character and a machine found it. The true version is that a machine lost a character, blamed the book, and wrote the accusation into a README, a report, a severity ranking and a six-post series outline — and that the accusation was falsifiable in one step by anyone willing to read the sentence.

That is not an argument against machine reading. The pipeline counted 447 mountains and 97,358 li across 26 chains, reconciled every summary sentence against its own entries, and produced the anomaly that led here. No human has done that pass. The machine's contribution was not the verdict; it was the exhaustiveness that made a verdict necessary. What it needed was a human willing to check the machine's work before believing the machine's story — and a lint rule that compares two layers on a shared field.

The *Shanhaijing*'s real contradictions are still there, and they are still worth having: a chain that counts 46 mountains and lists 47, a summary that opens with 白甘棗之山 where its siblings open with 自, a step count that contradicts itself in the same breath. Those are 2,300 years old. The 429% was four months old. The whole discipline is telling them apart.

If you want the machine's own inventory of what it found, [the 63 contradictions](/posts/shanhaijing-63-contradictions-machine-reading/) is the full tour, and [the pipeline post](/posts/shanhaijing-knowledge-graph-pipeline/) shows the layers this number travelled through. For the shape of the book itself, start with [the hub](/posts/machine-reading-shanhaijing-knowledge-graph/).

## Sources

- Wikisource, 《山海經》 (Guo Pu annotated edition, public-domain base text; chapter 003 line 186 and chapter 009 line 19), retrieved 2026-10-21, https://zh.wikisource.org/wiki/%E5%B1%B1%E6%B5%B7%E7%B6%93
- Shanhaijing structure build report (SKILL_02a), per-chain counted versus declared distance and mountain totals for all 26 chains, retrieved 2026-10-21, https://findns.cc/shanhaijing
- Shanhaijing conflict report (SKILL_07g), 63 recorded contradictions with verdicts, confidence tiers and `our_bug` status, retrieved 2026-10-21, https://findns.cc/shanhaijing
- Shanhaijing route reconciliation (SKILL_03n), `ROUTE-003-3.json` and `route_index.json` per-chain stop counts and distances, retrieved 2026-10-21, https://findns.cc/shanhaijing
- Shanhaijing record units (SKILL_04g), `records.json` entry 003-213 with the declared total of 12,350 li, retrieved 2026-10-21, https://findns.cc/shanhaijing
- Shanhaijing knowledge graph, entity index, relation tables and site statistics (18 chapters / 447 mountains / 26 chains / 97,358 li / 32,316 characters), retrieved 2026-10-21, https://findns.cc/shanhaijing
- Wikipedia, "山海经" (authorship, dating, chapter structure and the 447 / 477 / 550 mountain-counting conventions), retrieved 2026-10-21, https://zh.wikipedia.org/wiki/%E5%B1%B1%E6%B5%B7%E7%BB%8F
- Wikipedia, "校勘学" (讹文 / 脱文 / 衍文 / 异文 categories and the 对校 / 本校 / 他校 / 理校 methods), retrieved 2026-10-21, https://zh.wikipedia.org/wiki/%E6%A0%A1%E5%8B%98%E5%AD%B8
