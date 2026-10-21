---
title: "The Nine-Tailed Fox Is Missing From My Shanhaijing Dataset — And That's the Point"
description: "Of 135 creature slots in the Shanhaijing text, 4 are never named, and the nine-tailed fox is one. My knowledge graph of 202 creatures logs why it is absent."
coverImage: "/posts/shanhaijing-nine-tailed-fox-missing/images/cover.jpg"
coverImageAlt: "Ming dynasty woodblock line drawing of the nine-tailed fox from the Shanhaijing, set against dark misty mountain silhouettes"
ogImage: "/posts/shanhaijing-nine-tailed-fox-missing/images/cover.jpg"
date: "2026-10-21 10:00:00"
lastUpdated: "2026-10-21 10:00:00"
author: "FindNS94"
tags: [Shanhaijing, Culture, AI]
---

![Ming dynasty woodblock line drawing of the nine-tailed fox from the Shanhaijing, set against dark misty mountain silhouettes](/posts/shanhaijing-nine-tailed-fox-missing/images/cover.jpg)

## Introduction

The nine-tailed fox is the most famous creature in the *Classic of Mountains and Seas* (山海经). It is the one everybody can name. It is the one that shows up on tea tins, in anime, in the K-pop-adjacent corner of the internet, in a hundred years of folklore about foxes that turn into women.

It is not in my dataset.

My Shanhaijing knowledge graph indexes **202 distinct creatures** across **217 recorded sightings on 166 place names**. It has 1,041 text records, 271 `inhabits` relations, and a three-layer coordinate system with 820 location nodes. The nine-tailed fox has zero of them. If you search the creature index for 九尾狐, you get an empty list.

I did not fix this. I am not going to fix it. And this post is the explanation of why that is a feature rather than a bug — and why I think it is the single most important design decision in the whole project.

This is post 5 of 6 in a series about machine-reading the Shanhaijing. The [hub post](/posts/machine-reading-shanhaijin-knowledge-graph/) covers the project as a whole; here I want to zoom in on one deliberate hole and what it says about building knowledge bases that a language model, or a human, can actually trust.

<!-- more -->

> **Key Takeaways**
> - **The nine-tailed fox is absent from a 202-creature dataset** because the base text never names it — it says only "its shape is like a fox with nine tails"
> - **135 creature slots, 12 without a node** — 8 are naming-formula misses, 4 are genuinely unnamed in the text, and the fox is one of the four
> - **820 coordinate nodes ship in three confidence layers** — 405 confirmed, 42 inferred, 373 mythical with `x = null`
> - **The copyright red line is a date** — 袁珂's standard edition stays protected until 2051-12-31, so the project uses the public-domain 郭璞 edition
> - **宁缺勿错** — prefer omission over error; the dataset documents its own gaps instead of guessing

---

## What Does the Dataset Actually Contain?

The graph covers 18 chapters and 447 mountains in 26 mountain ranges, and it records **202 distinct creatures across 217 sightings on 166 place names** — 145 of the 447 山经 mountains (32.4%) plus 21 locations in the 海经 chapters ([project data](/posts/shanhaijing-knowledge-graph-pipeline/), `kg/space/data/creature_sightings.json`). Nine of those creatures appear in more than one chapter or mountain range: 人魚 in five separate locations, plus 旋龜, 肥遺, 蠻蠻, 䱻魚, 文貝, 嚻, 飛魚 and 駮.

The numbers are small on purpose. The full text is about 32,316 Chinese characters — roughly a twentieth the size of the *Records of the Grand Historian* (史记) that inspired the pipeline. At that scale you can afford to hand-audit every edge, and the project does.

What matters for this post is the shape of the creature layer. It is not a list of every animal mentioned in the text. It is a list of every animal the text **gives a name to**, because a name is the thing that lets you build a stable node, deduplicate across chapters, and trace an edge back to a line of source text.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-nine-tailed-fox-missing/charts/chart-1-three-coordinate-layers.svg"
       alt="Donut chart showing 820 Shanhaijing location nodes split into three coordinate confidence layers: 405 confirmed nodes with complete direction and distance, 42 inferred nodes that are chain-head mountains without a direction word, and 373 mythical nodes that carry topology only and no coordinates at all"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

<!-- [ORIGINAL DATA] Counted directly from the project's own tagged corpus: 135 creature slots introduced by 有X焉 across the 18 chapters; 12 produce no named-creature node under the stated rule, spread across 6 chapters — 西山经 4, 南山经 2, 北山经 2, 中山经 2, 东山经 1, 海外西经 1. -->

> **Citation capsule:** The Shanhaijing knowledge graph indexes 202 distinct creatures across 217 sightings on 166 place names — 145 of them 山经 mountains, or 32.4% of the 447 — with 1,041 text records and 271 `inhabits` relations, all traceable to a paragraph number (project data, `kg/space/data/creature_sightings.json`, 2026).

---

## Why Is the Nine-Tailed Fox Missing?

Because the base text describes it without ever naming it. In 《南山经》之首, the eighth mountain entry — 青丘之山, paragraph number 001-1.7 — reads:

> 又東三百里，曰青丘之山，其陽多玉，其陰多青雘。**有獸焉，其狀如狐而九尾**，其音如嬰兒，能食人；食者不蠱。

"Three hundred li further east is Mount Qingqiu... **There is a beast there whose shape is like a fox with nine tails**; its sound is like a baby's cry; it can eat people; whoever eats it is not afflicted by bewitchment."

Everything about the fox is there except the fox's name. Compare the very next sentence in the same entry: 有鳥焉，其狀如鳩，其音若呵，**名曰灌灌** — "there is a bird... its name is called Guanguan." The bird gets 名曰. The fox does not.

The extractor is a rule-driven pattern matcher, and its core creature rule is deliberately narrow ([SKILL_05g](/posts/shanhaijing-knowledge-graph-pipeline/), §4):

```
INHABITS_PATTERN = re.compile(r'有(兽|鸟|鱼|蛇|虫)焉[^\n]{0,80}?其名曰〖?\+?([^〖〗，。；\s]+)〗?')
```

It requires the formula 有X焉 … 其名曰Y. At 青丘之山, the passage satisfies the first half and fails the second. No name, no node, no `inhabits` edge. The pipeline then correctly recorded four other things at the same paragraph number: the mountain itself (record 001-020), the bird 灌灌 (001-021), the river 英水 (001-022), and the fish 赤鱬 (001-023).

<!-- [UNIQUE INSIGHT] The fox is not absent from the corpus — it is absent from the graph. Its full description survives verbatim inside record 001-020's `original` field, because that record stores the whole mountain entry. The gap is precisely one edge: text present, node missing. -->

This is the part I find genuinely interesting. The fox is **in the data**. It is sitting inside record 001-020, quoted word for word, in a field that exists so that a linter can compare the record against the base text byte by byte. What is missing is not the text. What is missing is the *node* — the thing that would let you query "which mountains have nine-tailed foxes?" or "what eats people?" and get an answer.

A conventional dataset would have quietly patched that. Someone would have typed `九尾狐` into a spreadsheet, pointed it at 青丘之山, and moved on. That patch would have been invisible, unverifiable, and wrong in a specific way: it would have attributed a name to a text that does not contain it. Downstream, an LLM would retrieve the relation, generate a sentence saying "the Shanhaijing names the nine-tailed fox at Mount Qingqiu," and be confidently inaccurate about a 2,000-year-old poem.

The project's README says it plainly, in a warning attached to the creature-distribution layer:

> ⚠️ **九尾狐不在数据集中** —— 《山海经》青丘之山原文作「其状如狐而九尾」，**异兽未命名**，上游未生成 `inhabits` 关系。这是上游数据事实，非本层遗漏。

"The nine-tailed fox is not in the dataset... the creature is unnamed; the upstream layer generated no `inhabits` relation. This is an upstream data fact, not an omission in this layer."

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-nine-tailed-fox-missing/charts/chart-2-creature-slots-named-vs-unnamed.svg"
       alt="Horizontal bar chart of 135 creature slots in the Shanhaijing text: 123 produced a named creature node, 12 did not; of those 12, 8 are text-named creatures the extraction formula missed and 4 are never named in the base text, including the nine-tailed fox at Mount Qingqiu"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

<figure style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/shanhaijing-nine-tailed-fox-missing/images/nine-tailed-fox-gujin-tushu-jicheng.png"
       alt="Eighteenth-century woodblock illustration of the nine-tailed fox perched on a flowering tree, titled 九尾狐圖, from the Qing imperial encyclopaedia Gujin Tushu Jicheng"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

---

## Is This a Bug or a Deliberate Design Decision?

It is a deliberate decision with a documented bug inside it, which is the honest answer. Counting every creature slot introduced by 有獸焉 / 有鳥焉 / 有魚焉 / 有蛇焉 / 有蟲焉 across the 18 tagged chapters gives **135 slots, of which 12 (8.9%) produced no named-creature node**. Those 12 split cleanly in two.

**Eight are extraction misses.** The text names the creature, just not with 名曰: 長右 (其名長右), 橐𩇯 (曰橐𩇯), 𤛎 (其狀曰𤛎), 猙 (其名如猙), 旄牛 (或曰旄牛), 𤟤 (其名山𤟤), 山膏 (名曰山膏, mis-tagged as a mountain name), and 𤜣狼 (名𤜣狼). A broader regex would catch these. It would also start swallowing verbs and place names — the exact failure mode the 1–2 character mountain-name limit was introduced to prevent.

**Four are never named at all.** The nine-tailed fox at 青丘之山 (001-1.7); the owl-faced, monkey-bodied bird at 崦嵫之山 (002-4.18) whose "name is its own cry" (其名自號也); the bristle-backed beast at 犲山 (004-1.9) whose appearance 見則天下大水; and the two-headed bird beside 奇肱之國 in 《海外西经》 (007-7). These are not extractor failures. The base text genuinely declines to name them.

The project's stated position, recorded as decision D5 in the README, is:

> **不追求覆盖率，追求零错误** — do not chase coverage; chase zero errors.

So the creature layer has 202 nodes rather than 206, and the four missing ones are named in the documentation instead. The same principle shows up in the annotation layer, which covers 11,041 of 31,418 characters (35.14%) and openly lists its own weaknesses: coverage of the 海经 chapters sits between 11% and 21%, three-character toponyms like 三天子鄣山 fall outside the mountain-name rule, and five symbol classes have empty corpora because the project refused to force-fit them.

> **Citation capsule:** Of 135 creature slots in the Shanhaijing text, 123 (91.1%) became named graph nodes and 12 (8.9%) did not — 8 because the naming formula varies and 4 because the creature is never named (project data, 18 tagged chapters, 2026).

---

## How Do You Publish Coordinates Without Lying About Them?

You publish them in labelled layers and you let the least trustworthy layer carry no coordinates at all. The project's spatial layer holds **820 location nodes** — 447 from the 山经 chapters and 373 from the 海经 chapters — sorted into three confidence classes with a stated rule for each (project data, `kg/space/data/place_coords.json`, 2026).

**Layer 1 — `confirmed` (405 nodes).** The mountain has both a direction word and a distance in the text, so it can be chained from its neighbours. These are 405 of the 447 山经 mountains, 90.6% of that layer.

**Layer 2 — `inferred` (42 nodes).** These are overwhelmingly range-head mountains: the text says 曰招搖之山 and gives no direction at all, because there is nothing before it to measure from. The pipeline places them at the chain origin and flags them. It does not invent a bearing. Every one of the 447 山经 nodes carries `estimated: true`.

**Layer 3 — `mythical` (373 nodes).** The 海经 chapters describe 青丘國, 不死之山, 結匈國 — places with no range structure and no defensible position. These nodes get topology (which entry comes before which, what landmark is referenced) and nothing else. All 373 have `x = null` and `y = null`. Not approximated, not defaulted, not zeroed out. Null.

Two rules make this hold together. First, **no modern conversion**: coordinates are abstract plane values in 里 (li), the text's own unit, and the validation pass explicitly checks that no coordinate field contains "公里" (kilometres) or a latitude/longitude pair. The project will not tell you where 招搖之山 is on a modern map, because it does not know and neither does anyone else with confidence.

Second, **no silent conflict resolution**. When two parallel attempts to define layer 1 and layer 2 disagreed, the project wrote the disagreement down rather than averaging it. One approach graded by station completeness — does this mountain have a full direction-plus-distance pair? — and produced 405 confirmed nodes. The other graded by whole-route arithmetic — does the sum of a range's legs match its closing summary line? — and found that 24 of 26 ranges do not match, which would have collapsed layer 1 to zero nodes. The project adopted the station-level rule as decision D10, on the reasoning that a route-arithmetic mismatch does not make an individual mountain unlocatable, and kept the route-level discrepancies in a separate 63-item conflict report.

That is the design goal stated in one word: **不误导** — do not mislead. A map that puts a mythical kingdom at a real latitude is not a map with a small error. It is a map that has stopped being a map.

> **Citation capsule:** The Shanhaijing spatial layer holds 820 nodes in three confidence classes: 405 `confirmed`, 42 `inferred`, and 373 `mythical` — and all 373 mythical nodes ship with `x = null` rather than a fabricated position (project data, `kg/space/data/place_coords.json`, 2026).

---

## Why Does a Copyright Date Decide Which Edition You Can Read?

Because the most convenient edition of the Shanhaijing is locked until 2051. The standard modern annotated edition, 袁珂's 《山海经校注》, is under copyright in China until **2051-12-31** — 袁珂 died on 2001-07-14, and Chinese copyright runs for the author's life plus 50 years, expiring at the end of the fiftieth year ([project documentation](/posts/shanhaijing-63-contradictions-machine-reading/), `doc/shanhaijin/08_适配方案与行动清单.md`, 2026).

That is not a technicality to be waved away by "it's an ancient text." The *Shanhaijing* itself is two millennia old and unambiguously public domain. But a modern 校注 edition carries the editor's collation, punctuation, emendation choices and notes — and those are a new, protected work. Building a knowledge graph on top of 袁珂's editorial decisions would mean copying a protected layer of scholarship, not an ancient poem.

So the project uses the **郭璞 annotated edition**, available in the public domain from Wikisource. 郭璞 was a Jin dynasty commentator (276–324 CE), and the Wikisource transcription is PD-old. The trade-off is real and it is documented: the Wikisource base text is user-contributed and uncollated, its commentary coverage is patchy — 105 notes in 《南山经》, 280 in 《西山经》, 5 in 《海内东经》, and none at all in the other 16 chapters — and the project explicitly accepted that gap as decision D2 rather than blocking the pipeline on it.

The same logic governs the pictures. The cover of this post and the illustration above are woodblock prints from Ming and Qing compendia — 胡文焕's 《山海经图》 (16th–17th century) and the Qing imperial encyclopaedia 《古今圖書集成》 (compiled 1700–1725) — both long out of copyright, both downloaded from Wikimedia Commons with their licence recorded. Modern illustrated compendia, such as 马昌仪's 2007 《古本山海经图说》, are protected and are used for reference only, never reproduced.

I did not want to write that paragraph as an abstraction. If the post argues that a dataset should be able to show its provenance, the post's own images had better be able to do the same.

> **Citation capsule:** 袁珂's 《山海经校注》 remains under copyright until 2051-12-31 because its author died in 2001, so the project builds on the public-domain 郭璞 annotated edition from Wikisource instead (project documentation, `08_适配方案与行动清单.md`, 2026).

---

## What Happens When Your Own Documentation Disagrees With Your Own Data?

You log it in public, because a project that claims to document its gaps does not get to quietly paper over its own. Two examples, both real, both currently sitting in the repository.

**The layer counts disagree across files.** The primary coordinate deliverable, `place_coords.json`, reports 405 `confirmed` / 42 `inferred` / 373 `mythical` — the D10 decision described above. Two companion files, `layers.json` and `logs/place_coords_report.md`, still report 0 / 447 / 373, which is the output of the rejected route-arithmetic rule. Same dataset, same date, two different stories about how many mountains are locatable.

**The chapter attribution is wrong in the documentation.** The project README, and an earlier draft of this post, filed the nine-tailed fox passage under 《西山经》. The base text puts 青丘之山 in 《南山经》之首, paragraph 001-1.7, which is where the record actually lives. 《西山经》 does contain a 九尾 — but it belongs to 陸吾, the tiger-bodied, nine-tailed deity who governs 昆仑之丘, and deities are a separate entity class that the creature layer excludes by design. So this post is where the correction gets recorded: **《南山经》之首, 001-1.7**, and the README's note is flagged as a doc fix rather than silently edited.

<!-- [PERSONAL EXPERIENCE] I found the chapter error by grepping the base text for 九尾 instead of trusting the README — the fox is at 南山经 001-1.7, and the only 九尾 in 西山经 belongs to the god 陆吾. The lesson generalises: provenance claims in your own docs need the same verification as claims in your data. -->

Neither of these is fatal, and both are the point. A project whose entire quality argument is "we record what we cannot do" has to apply that argument to its own artefacts, or the argument is just marketing. The conflict layer is the same discipline at larger scale: the pipeline found **63 textual contradictions** in the *Shanhaijing* itself — including a 429% distance discrepancy in 《北次三经》 where the closing summary claims 2,350 li against 12,440 li counted leg by leg — and resolved exactly zero of them by editing the text. Every one is recorded with a paragraph number and left standing. The count of `our_bug` entries — contradictions caused by the project's own parsing errors — is zero, and getting there took three documented fixes to the direction-chain layer.

> **Citation capsule:** The project's own files disagree about its headline number: `place_coords.json` reports 405 confirmed coordinate nodes while `layers.json` still reports 0, and both are shipped in the same repository rather than reconciled by hand (project data, 2026).

---

## Why Does a Knowledge Graph That Admits Its Gaps Beat One That Doesn't?

Because a gap you can see is a gap you can reason about, and a gap you cannot see is a hallucination waiting to happen. This is the practical argument, and it is the reason I stopped trying to make the numbers look better.

When a language model answers a question from a knowledge graph, it does not know what the graph does not contain. It sees an entity list, a set of relations, and a plausible question. If the nine-tailed fox is simply absent, the model has three options: say nothing, say the graph does not contain it, or confabulate. A dataset that carries an explicit, retrievable note — "the fox is described at 001-1.7 but never named, so no `inhabits` relation exists" — converts that third option into the second. The null becomes an answer instead of a void.

Several design choices in this project exist purely to make that work at scale:

- **Every relation is traceable to a paragraph number** (hard rule R12 in the relation-building spec). There is no edge you cannot walk back to a line of source text.
- **Confidence scores gate admission.** Relations below 0.50 are routed to a human queue rather than stored (R15). The `inhabits` edges that survive carry a tier — the 灌灌 and 赤鱬 edges at 青丘之山 score 1.0 and 0.93.
- **Unknown stays unknown.** Where scholarship genuinely disagrees — whether 帝俊 and 帝喾 are the same figure, for instance — the project stores a `same_as` edge with `disputed: true` and a note, rather than merging the entities.
- **Empty classes stay empty.** Five of the twenty entity symbol classes have no corpus and were left at zero rather than being populated to make a coverage table look complete.

If you want the mechanics of how those records get built, the [pipeline walkthrough](/posts/shanhaijing-knowledge-graph-pipeline/) covers the nine stages; if you want to see the contradiction layer in full, the [63-contradictions post](/posts/shanhaijing-63-contradictions-machine-reading/) goes through the arithmetic; the [429% distance puzzle](/posts/shanhaijing-missing-character-429-percent/) is the textual-criticism follow-up to this one. And the [zero-dependency visualization post](/posts/shanhaijing-zero-dependency-visualization/) shows how the three coordinate layers render without a single external library.

> **Citation capsule:** All 271 `inhabits` relations in the Shanhaijing graph trace to a paragraph number, and relations scoring below 0.50 are excluded from the store — a threshold that trades recall for the guarantee that every stored edge can be checked (project data, `kg/relations/biology_relations.json`, 2026).

---

## What Should You Do With a Dataset That Admits Its Holes?

Treat the holes as data, publish them next to the numbers, and stop measuring quality by coverage alone. Three habits transfer to any project.

**Report the denominator, always.** "202 creatures" is meaningless without "across 447 mountains and 135 creature slots." The fact that only 145 of the 447 山经 mountains (32.4%) host an indexed creature looks like failure until you notice that most mountain entries are about minerals, rivers and plants — and you only notice that by publishing the ratio.

**Distinguish "we missed it" from "it isn't there."** The 12 unnamed creature slots split 8/4, and the two halves have completely different implications: one is a fixable extractor limitation, the other is a property of the source. Conflating them makes both invisible.

**Make the missing thing findable.** A reader who searches for the nine-tailed fox should hit the explanation, not an empty result. That is why this post exists, and why the README carries the warning inline rather than in a changelog nobody reads.

None of this makes the dataset bigger. It makes it honest, which in the long run is the only thing that makes it usable.

---

## Frequently Asked Questions

### Is the nine-tailed fox actually in the Shanhaijing?

Yes — it is described three times, but named zero times. 《南山经》之首 001-1.7 gives a beast "whose shape is like a fox with nine tails"; 《海外东经》 mentions the 青丘國 whose foxes have four legs and nine tails; 《大荒东经》 says simply "there is a country called 青丘, with foxes, nine-tailed." The name 九尾狐 comes from the commentary tradition — 郭璞's fourth-century note on the 青丘之山 passage reads, in full, 「即九尾狐」.

### Why not just add the fox to the dataset manually?

Because a manual patch would attribute a name the text does not contain, and every downstream citation would inherit that falsehood. The project's rule is 宁缺勿错 — prefer omission over error — so the fox stays out of the 202 and the reason stays in the documentation.

### Are the coordinates in the visualization real geographic coordinates?

No. They are abstract plane values in 里 (li), the text's own unit, chained from each range's first mountain and explicitly flagged `estimated: true` across all 447 山经 nodes. The 373 海经 nodes carry no coordinates at all, only topology. No node has a latitude or longitude.

### Can I reuse this dataset or the illustrations?

The dataset derives from the public-domain 郭璞 annotated edition on Wikisource, so the underlying text is free; the project's own annotations and relations are its own work. The illustrations here are Ming and Qing woodblock prints — 胡文焕's 《山海经图》 and the Qing 《古今圖書集成》 — both public domain. 袁珂's copyrighted 校注 is deliberately not used as a source.

### How much of the Shanhaijing is actually annotated?

About a third. The entity-annotation layer covers 11,041 of 31,418 characters (35.14%), with the 山经 chapters far denser than the 海经 chapters, which sit between 11% and 21%. The project documents the shortfall rather than padding it.

---

## Conclusion

The nine-tailed fox is the most famous creature in the *Classic of Mountains and Seas*, and it is not in my creature table — because the text describes it without naming it, and because I would rather ship a dataset with a documented hole than one with a convenient fabrication. Along the way that same principle produced a three-layer coordinate system where 373 of 820 nodes have no coordinates at all, a copyright decision driven by a 2051 expiry date, and a repository that ships two disagreeing layer counts rather than quietly deleting one.

If you take one thing from this series, take the shape of the argument rather than the specific numbers: **a knowledge graph's most valuable field is often the one that says `null`, and its most valuable document is the one that says why.** The next post takes that same discipline into a textual-criticism puzzle, where a single dropped character produces a 429% distance error that the project records and refuses to correct.

Start with the [hub post](/posts/machine-reading-shanhaijin-knowledge-graph/) if you want the whole project in one place, or browse the [live Shanhaijing reader](/shanhaijin) to check any of these claims against the source text yourself. Everything cited in this post is verifiable from the repository.

## Sources

- Shanhaijing knowledge graph, project repository, `doc/shanhaijin/000_README.md` (creature distribution, three-layer design, decision log D1–D10, known defects), retrieved 2026-10-21
- Shanhaijing knowledge graph, `kg/space/data/place_coords.json` (820 nodes; `confirmed` 405 / `inferred` 42 / `mythical` 373; `layer_basis`, `estimated` flags), retrieved 2026-10-21
- Shanhaijing knowledge graph, `kg/space/data/creature_sightings.json` (202 distinct creatures, 217 sightings, 166 place names, 9 multi-chapter creatures), retrieved 2026-10-21
- Shanhaijing knowledge graph, `kg/space/data/layers.json` and `logs/place_coords_report.md` (the divergent 0 / 447 / 373 layer counts), retrieved 2026-10-21
- Shanhaijing knowledge graph, `kg/relations/biology_relations.json` (271 `inhabits` relations with confidence tiers and paragraph numbers), retrieved 2026-10-21
- Shanhaijing knowledge graph, `skills/SKILL_05g_物产与异兽关系.md` (§4 `INHABITS_PATTERN`, §9.3 hard rules R1–R15), retrieved 2026-10-21
- Shanhaijing knowledge graph, `doc/shanhaijin/08_适配方案与行动清单.md` (§1.5–1.6 edition selection and the 袁珂 2051-12-31 copyright boundary), retrieved 2026-10-21
- Shanhaijing knowledge graph, `chapter_md/001_南山经.tagged.md` and `kg/records/data/records.json` (青丘之山 at PN 001-1.7; records 001-020 through 001-023), retrieved 2026-10-21
- Wikisource, 《山海經》 (郭璞 annotated edition, PD-old), https://zh.wikisource.org/wiki/%E5%B1%B1%E6%B5%B7%E7%B6%93, retrieved 2026-10-21
- Wikimedia Commons, "南山經-九尾狐" from 胡文焕 《山海经图》 (Ming dynasty, public domain), https://commons.wikimedia.org/wiki/File:%E5%8D%97%E5%B1%B1%E7%B6%93-%E4%B9%9D%E5%B0%BE%E7%8B%90.svg, retrieved 2026-10-21
- Wikimedia Commons, "Imperial Encyclopaedia — Animal Kingdom — pic176 — 九尾狐圖" from 《古今圖書集成》 (1725, public domain), https://commons.wikimedia.org/wiki/File:Imperial_Encyclopaedia_-_Animal_Kingdom_-_pic176_-_%E4%B9%9D%E5%B0%BE%E7%8B%90%E5%9C%96.png, retrieved 2026-10-21
