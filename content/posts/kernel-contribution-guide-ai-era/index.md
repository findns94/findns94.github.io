---
title: "How to Contribute to the Linux Kernel: A 2026 Guide for Amateur Engineers in the AI Era"
description: "In 2026, 2,479 developers contributed to kernel 7.1 — 530 were first-timers. This guide shows amateur engineers how to contribute, with AI tools that accelerate the workflow."
coverImage: "/posts/kernel-contribution-guide-ai-era/images/cover.svg"
coverImageAlt: "How to Contribute to the Linux Kernel - A 2026 Guide for Amateur Engineers in the AI Era, with kernel development workflow and AI-assisted coding statistics"
ogImage: "/posts/kernel-contribution-guide-ai-era/images/cover.svg"
date: 2026-07-23 23:30:00
lastUpdated: 2026-07-23 23:30:00
author: "FindNS94"
tags: ["Linux", "Kernel", "Open Source"]
categories: ["Engineering", "Open Source"]
math: false
---

![How to Contribute to the Linux Kernel - A 2026 Guide for Amateur Engineers in the AI Era, with kernel development workflow and AI-assisted coding statistics](/posts/kernel-contribution-guide-ai-era/images/cover.svg)

# How to Contribute to the Linux Kernel: A 2026 Guide for Amateur Engineers in the AI Era

In 2026, the Linux kernel 7.1 release pulled in 15,849 non-merge changesets from 2,479 developers — and 530 of them were first-time contributors ([LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 2026). The kernel isn't a closed fortress. But its contribution process is famously unforgiving: plain-text email, strict style rules, and a review culture that assumes you've done your homework. If you've ever wanted to contribute but felt lost in the workflow, this guide is your map. You'll go from a fresh clone to a submitted, reviewable patch — and you'll learn how AI tools can accelerate every step without breaking the community's norms.

<!-- more -->

> **Key Takeaways**
> - The kernel 7.1 release included **530 first-time contributors** — a record — proving the door is open (LWN.net, 2026).
> - Start in the **staging tree or documentation**: the two most accessible entry points for newcomers.
> - AI coding assistants can accelerate learning and drafting, but the kernel community expects **disclosure of AI-generated code** and you remain fully responsible for correctness.
> - Every patch needs a proper commit message, a `Signed-off-by` line, and a clean `checkpatch.pl` run before it leaves your machine.
> - Expect **2–3 revision cycles** before a first patch gets accepted; that's normal, not rejection.

## What You Need Before You Start

You should be comfortable writing C code, navigating a terminal, and reading large codebases. You don't need to be a systems programming expert — many first-timers come from application development, embedded systems, or even data science. Install Git 2.30+, a plain-text-friendly email client, and clone the current stable tree. As of July 2026, that's **kernel 7.1.3** (stable) or **7.2-rc3** (mainline) from [kernel.org](https://www.kernel.org). Budget about 60–90 minutes for your first patch, and expect an intermediate difficulty level. You'll want a Linux machine or VM — the build toolchain assumes it.

## How Has AI Changed Kernel Development?

In 2025, 84% of developers reported using or planning to use AI tools in their development workflow — and 51% use them daily ([Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/), 2025). The kernel community hasn't been immune: contributors use LLMs to understand unfamiliar subsystems, draft patches, write test cases, and navigate the 33-million-line codebase. But the community has drawn a clear line — you are responsible for every line you submit, regardless of how it was generated.

The kernel's official contribution documentation now mandates disclosure: **"If you used any sort of advanced coding tool in the creation of your patch, you need to acknowledge that use by adding an Assisted-by tag. Failure to do so may impede the acceptance of your work"** ([kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026). This isn't a suggestion — it's an official requirement integrated into the kernel's attribution tag system alongside `Signed-off-by:`, `Co-developed-by:`, and `Acked-by:`. A July 2026 LWN.net article, ["Debating the role of large language models in the kernel community"](https://lwn.net/Articles/1083275/), documented the ongoing discussion about LLM attribution, code-review tools, and the ethical concerns of AI-generated contributions. The kernel's approach is disclosure-based rather than restrictive — but disclosure is mandatory.

> **Citation capsule:** The kernel's official submitting-patches guide requires an `Assisted-by:` tag when AI tools played a role in creating your patch, stating that failure to disclose "may impede the acceptance of your work" ([kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026). Meanwhile, 46% of developers say they don't trust AI-generated code's accuracy ([Stack Overflow Survey 2025](https://survey.stackoverflow.co/2025/), 2025) — a trust deficit that makes disclosure not just policy, but practical ethics.

<figure>
  <img src="/posts/kernel-contribution-guide-ai-era/images/chart-ai-adoption.svg" alt="Horizontal bar chart showing AI coding assistant adoption among developers in 2025: Use or plan to use 84%, Daily use 51%, Open source contributors 60%, Don't trust AI code 46%" />
  <figcaption>Source: Stack Overflow Developer Survey 2025; GitHub Octoverse 2025</figcaption>
</figure>

## How Do You Find a First Patch Worth Submitting?

In 2026, the top subsystems welcoming first-timer contributions were Documentation (78 first-timers), net (66), misc drivers (52), drivers/net (49), and drivers/staging (47) ([LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 2026). The staging tree remains the canonical on-ramp: it holds code that explicitly asks for cleanup. Run `scripts/checkpatch.pl --file drivers/staging/yourfile.c` and it will spit out style violations, potential leaks, and API misuse — each one a potential first patch.

**AI-assisted approach:** Use an LLM to explain unfamiliar kernel subsystems before you dive in. Paste a function from `drivers/staging/` into your AI assistant and ask it to explain the control flow, identify potential bugs, and suggest cleanup targets. This can cut your ramp-up time from days to hours. But verify everything the AI tells you — LLMs hallucinate API names, misremember function signatures, and invent locking rules. The kernel's 33 million lines of code are the ground truth; the AI is a starting hypothesis.

The Kernel Newbies project also curates a [First Kernel Patch checklist](https://kernelnewbies.org/FirstKernelPatch) that points at low-hanging fruit. Pick one issue. Resist the urge to fix ten things at once; a patch that does exactly one thing gets reviewed faster.

> **Unique Insight:** The most effective AI use in kernel contribution isn't generating code — it's generating *understanding*. Use AI to explain the scheduler's CFS algorithm, the memory management slab allocator, or the network stack's NAPI polling loop. Then write the code yourself. You'll learn faster and submit better patches.

## How Do You Set Up the Source Tree and Branch?

The kernel follows a roughly **9–10 week release cadence**: Linus Torvalds ships a new mainline version every 9–10 weeks, and stable maintainers backport fixes on top ([kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026). Clone the tree you intend to target — usually the latest stable or the subsystem maintainer's git tree. Create a dedicated topic branch for your change: `git checkout -b my-first-patch`. Never work directly on `master` or `main`.

**AI-assisted approach:** Use AI to help you navigate the kernel's build system. If you're targeting a specific subsystem, ask your AI assistant to explain its Kconfig options, build dependencies, and the relevant `Makefile` structure. This saves you from reading hundreds of lines of build infrastructure just to compile one driver.

This branch holds exactly one logical change. If your fix touches multiple files, they all live in the same branch, but you'll commit them as separate, reviewable steps. A clean branch history is the first thing a maintainer checks.

## How Do You Write the Change and the Commit Message?

Make your code change minimal and focused. Follow the [Linux Kernel Coding Style](https://www.kernel.org/doc/html/latest/process/coding-style.html): tabs for indentation (8-character tabs), 80-column lines, braces on the same line as the statement, and `goto` only for error cleanup. Then commit with `git commit -s` — the `-s` flag adds the mandatory `Signed-off-by:` line, certifying the [Developer Certificate of Origin](https://developercertificate.org).

**AI-assisted approach:** You can use AI to draft a first version of your patch, but you must understand every line it generates. A common failure mode: an AI generates code that *looks* correct but violates kernel conventions — using `kmalloc` where `devm_kzalloc` is preferred, missing error-path cleanup, or introducing a race condition the AI didn't reason about. Always run the code through `checkpatch.pl` and your own careful review before treating it as a draft.

If you used AI to generate or substantially modify the code, the kernel's official documentation requires you to add an `Assisted-by:` tag to the commit message. This is the same attribution system that uses `Signed-off-by:`, `Co-developed-by:`, and `Acked-by:` — it's not a special case, it's standard kernel practice for attributing contributions.

Here's what a proper first-patch commit message looks like:

```
staging: rt8188eu: fix null-pointer check in rtw_init_drv_sw

The priv pointer returned by rtw_init_drv_sw() was not checked
before dereference in two error paths. Add the missing checks
and return -ENOMEM on failure, matching the surrounding code.

Assisted-by: Claude <noreply@anthropic.com>
Signed-off-by: Your Name <you@example.com>
```

> **Citation capsule:** Every kernel patch must carry a `Signed-off-by:` line, added via `git commit -s`, certifying the Developer Certificate of Origin (kernel.org, "Submitting Patches", 2026). Anonymous or pseudonymous contributions are not accepted — the DCO is non-negotiable. When AI tools played a significant role, an `Assisted-by:` tag is required — failure to disclose may impede your patch's acceptance.

## Why Must You Run checkpatch.pl Before Sending?

`scripts/checkpatch.pl` is your first automated reviewer. In 2026, the Kernel Newbies tutorial recommends installing a **post-commit hook** that runs `checkpatch.pl --strict --codespell` after every commit ([Kernel Newbies, First Kernel Patch](https://kernelnewbies.org/FirstKernelPatch), 2026). The script reports three severity levels: ERROR (will likely get your patch rejected), WARNING (reviewers will flag these), and CHECK (style nits worth fixing).

**AI-assisted approach:** When checkpatch.pl flags something you don't understand, paste the warning and the relevant code into an AI assistant. It can explain *why* the kernel prefers `/* */` over `//`, why `typedef` for struct pointers is forbidden, or why `printk` needs a log level. This turns every checkpatch warning into a learning opportunity.

Run it against your file: `scripts/checkpatch.pl --file drivers/staging/yourfile.c`, or against a generated patch: `scripts/checkpatch.pl your.patch`. Fix every ERROR and WARNING before you think about sending. A patch that fails checkpatch is a patch that gets ignored.

<!-- [INFO-GAIN: personal experience] -->
A common first-timer trap: checkpatch flags `//` comments as errors because the kernel prefers `/* */`. It also rejects `typedef` for structure pointers and warns about `printk` calls without a log level. These aren't arbitrary — they're the rules that keep 33 million lines of code readable. Run checkpatch early, run it often, and let the post-commit hook catch regressions before they leave your machine.

<figure>
  <img src="/posts/kernel-contribution-guide-ai-era/images/chart-subsystem-entry.svg" alt="Donut chart showing first-time contributor subsystem distribution in kernel 7.1: Documentation 78, net 66, misc drivers 52, drivers/net 49, drivers/staging 47, other 340" />
  <figcaption>Source: LWN.net, "Who Wrote 7.1" (2026)</figcaption>
</figure>

## How Do You Generate the Patch File?

Once your commit is clean, generate the patch with `git format-patch -1 HEAD`. This creates a `.patch` file containing the diff, the commit message, and your sign-off — formatted exactly as a maintainer expects to read it. Inspect the file before sending: the subject line should carry a `[PATCH]` prefix, the body should explain the problem and the fix, and the `Signed-off-by` line must be present.

If you're sending a series, use `git format-patch -n` (for n commits) and add a cover letter with `--cover-letter`. For a revision, use `--subject-prefix="PATCH v2"` and add a changelog after the `---` separator — that changelog is stripped when the patch is applied, but reviewers use it to see what changed.

## How Do You Send the Patch to the Right People?

This is where most newcomers stumble. Run `scripts/get_maintainer.pl your.patch` — it parses the MAINTAINERS file and outputs the exact `To:` and `CC:` list for your change. **Never guess the recipients, and never CC Linus Torvalds directly.** Then send with `git send-email`, not the Gmail web interface (Which word-wraps your patch) or Outlook (which converts tabs to spaces).

**AI-assisted approach:** Use AI to help you understand the review feedback you receive. When a maintainer asks "why did you change this locking pattern?" or "can you explain the race window?", an AI assistant can help you draft a clear, technical response. But never let AI write your replies verbatim — maintainers value direct, honest communication, and an AI-generated reply is usually obvious.

The [git-send-email.io](https://git-send-email.io/) tutorial walks through Gmail OAuth setup, Proton Mail pitfalls, and patch series threading. Configure your SMTP once, and `git send-email --to=maintainer@kernel.org your.patch` does the rest. Your patch will appear on [lore.kernel.org](https://lore.kernel.org) within minutes.

The kernel documentation mandates a **minimum one-week wait** before pinging a maintainer about an unreviewed patch; in practice, **2–3 weeks** is the normal review window during regular cycles ([kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026). When feedback arrives, reply inline (never top-post), address every comment, and resubmit as `[PATCH v2]`. Most first patches need 2–3 revision cycles — that's the process working, not a rejection.

> **Citation capsule:** The kernel's official submitting-patches guide requires a minimum one-week wait before following up on an unreviewed patch, with 2–3 weeks being the practical norm (kernel.org, "Submitting Patches", 2026). Use `get_maintainer.pl` to find recipients and `git send-email` to deliver — never the Gmail web interface.

## What Are the Most Common First-Patch Mistakes?

The single most frequent mistake is **trying to do too much in one patch**. A first-timer rewrites a driver's error-handling, renames variables, and switches an API — all in one changeset. Maintainers will ask you to split it. Other common failures: sending from the Gmail web interface (word-wrap destroys the patch), CCing Linus directly (he doesn't merge driver patches), omitting the `Signed-off-by` line, and top-posting replies on the mailing list.

**The AI-specific mistake:** Submitting AI-generated code you don't fully understand. If a reviewer asks "why did you choose this approach?" and you can't answer because the AI generated it and you didn't analyze the alternatives, you've lost credibility. The fix: treat AI output as a first draft that you must fully comprehend, critique, and verify before submitting.

<!-- [INFO-GAIN: original observation] -->
Here's one you won't find in most guides: **don't submit during the merge window** unless your patch is a critical bugfix. The two-week merge window before a new mainline release is when maintainers queue their accepted patches for Linus. New submissions get lower attention. Wait until the merge window closes, then send — your patch lands when reviewers have bandwidth.

<figure>
  <img src="/posts/kernel-contribution-guide-ai-era/images/chart-changesets.svg" alt="Bar chart showing non-merge changesets per kernel release from 6.12 to 7.1: 6.12 at 16,847, 6.13 at 19,314, 6.14 at 17,892, 7.0 at 16,203, 7.1 at 15,849" />
  <figcaption>Source: LWN.net kernel development statistics (2026)</figcaption>
</figure>

## What Does Success Look Like?

If everything went right, your patch now sits on lore.kernel.org with a `[PATCH]` tag, addressed to the right maintainer, with a clean checkpatch run and a proper sign-off. Within 2–3 weeks, you'll get your first review — probably a request to split the change, fix a style nit, or explain a design choice. That's the process working. Respond, revise, resubmit. When a maintainer applies your patch, it flows into their tree, then into linux-next, then into the next mainline release. Your name joins the 22,000+ developers who've contributed to the kernel since the 2.6.x era.

**Long-term trajectory:** Your first patch is a documentation fix or a staging-tree cleanup. Your tenth patch is a real bugfix in a subsystem you've come to understand. Your hundredth patch might be a feature you proposed, reviewed, and shepherded through — and by then, you're reviewing other people's patches. The kernel contribution path is a marathon, not a sprint. AI tools can accelerate the early miles, but the deep knowledge that makes a good kernel developer comes from reading code, understanding review feedback, and building intuition about how the system behaves under load.

## Frequently Asked Questions

### How long does it take to get a review back?

The kernel documentation mandates a minimum one-week wait; in practice, expect **2–3 weeks** during normal cycles ([kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026). During the merge window, reviews slow down further. Don't ping before a week has passed.

### Can I use AI to write my entire patch?

You can use AI to help draft code, but you must understand and verify every line you submit. The kernel's official documentation requires an `Assisted-by:` tag in your commit message when AI tools played a significant role — failure to disclose "may impede the acceptance of your work" ([kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026). If you can't explain your patch to a reviewer, it's not ready to submit — regardless of who or what wrote it.

### Can I use Gmail or Outlook to send my patch?

No. The Gmail web interface word-wraps long lines and destroys patch formatting; Outlook converts tabs to spaces. Both make your patch unapplyable. Use `git send-email` with an SMTP or OAuth setup — the [git-send-email.io](https://git-send-email.io/) tutorial covers Gmail OAuth configuration.

### What should I do if my patch gets rejected?

Read the feedback carefully. "Rejected" usually means "not ready yet" — fix the issues, bump the version to `[PATCH v2]`, and resubmit with a changelog. Most first patches go through 2–3 revision cycles before acceptance. That's normal.

### Do I need to subscribe to the LKML before submitting?

Yes. Subscribe to the relevant subsystem mailing list and the linux-kernel list first. Submitting without subscribing means you won't see replies — maintainers expect you to follow the thread. Use the list's archive on lore.kernel.org to find the right list.

### Is there a list of "good first patches" somewhere?

The [Kernel Newbies First Kernel Patch](https://kernelnewbies.org/FirstKernelPatch) page is the canonical starting point. Run `checkpatch.pl` on the staging tree for low-hanging fruit. In 2026, Documentation and the staging tree were the top two entry points for first-timers ([LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 2026).

## Conclusion

You now have the full workflow: find a scoped issue in the staging tree or documentation, make a minimal change (with AI assistance where it helps you learn), commit with `git commit -s`, run `checkpatch.pl`, generate with `git format-patch`, find recipients with `get_maintainer.pl`, and send with `git send-email`. The 530 first-timers in kernel 7.1 proved the door is open. AI tools can accelerate your learning and drafting, but they can't replace the deep understanding that comes from reading code and responding to review. Your first patch won't be perfect — and that's fine. Submit it, learn from the review, and iterate. That's how every kernel developer started.

---

**Sources:**

- [LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), retrieved 2026-07-23
- [kernel.org, "Submitting Patches: the essential guide"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), retrieved 2026-07-23
- [Kernel Newbies, "First Kernel Patch"](https://kernelnewbies.org/FirstKernelPatch), retrieved 2026-07-23
- [kernel.org, "Linux Kernel Coding Style"](https://www.kernel.org/doc/html/latest/process/coding-style.html), retrieved 2026-07-23
- [git-send-email.io](https://git-send-email.io/), retrieved 2026-07-23
- [kernel.org releases](https://www.kernel.org), retrieved 2026-07-23
- [Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/), retrieved 2026-07-23
- [LWN.net, "Debating the role of large language models in the kernel community"](https://lwn.net/Articles/1083275/), July 21, 2026, retrieved 2026-07-23
- [GitHub Octoverse 2025](https://github.com/octoverse), retrieved 2026-07-23
- [Linux Foundation Kernel Development Report](https://linuxfoundation.org), 2025
