---
title: "How to Submit Your First Linux Kernel Patch: A 2026 Step-by-Step Guide"
date: 2026-07-14 09:00:00
tags: [Linux, Kernel, Open Source, Development, Tutorial]
categories: [Engineering]
---

![A computer monitor displaying lines of colorful source code on a dark background](/posts/submit-linux-kernel-patch/images/cover-code-on-monitor.jpg)

# How to Submit Your First Linux Kernel Patch: A 2026 Step-by-Step Guide

In 2026, the Linux kernel 7.1 release pulled in 15,849 non-merge changesets from 2,479 developers — and 530 of them were first-time contributors ([LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 2026). The kernel isn't a closed fortress. But its contribution process is famously unforgiving: plain-text email, strict style rules, and a review culture that assumes you've read the manual. If you've ever wanted to contribute but felt lost in the workflow, this guide is your map. You'll go from a fresh clone to a submitted, reviewable patch — the same path those 530 newcomers walked this year.

<!-- more -->

> **Key Takeaways**
> - The kernel 7.1 release included **530 first-time contributors** — a record — proving the door is open (LWN.net, 2026).
> - Start in the **staging tree or documentation**: the two most accessible entry points for newcomers.
> - Every patch needs a proper commit message, a `Signed-off-by` line, and a clean `checkpatch.pl` run before it leaves your machine.
> - Use `git send-email` to the recipients `get_maintainer.pl` gives you — never the Gmail web interface.
> - Expect **2–3 revision cycles** before a first patch gets accepted; that's normal, not rejection.

## What You Need Before You Start

You should be comfortable compiling C code, navigating a terminal, and reading kernel source. You don't need to be a systems programming expert — many first-timers come from application development. Install Git 2.30+, a plain-text-friendly email client, and clone the current stable tree. As of July 2026, that's **kernel 7.1.3** (stable) or **7.2-rc3** (mainline) from [kernel.org](https://www.kernel.org). Budget about 60–90 minutes for your first patch, and expect an intermediate difficulty level. You'll also want a Linux machine or VM — the build toolchain assumes it.

## How Do You Find a First Patch Worth Submitting?

In 2026, the top subsystems welcoming first-timer contributions were Documentation (78 first-timers), net (66), misc drivers (52), drivers/net (49), and drivers/staging (47) ([LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 2026). The staging tree remains the canonical on-ramp: it holds code that explicitly asks for cleanup. Run `scripts/checkpatch.pl --file drivers/staging/yourfile.c` and it will spit out style violations, potential leaks, and API misuse — each one a potential first patch. The Kernel Newbies project also curates a [First Kernel Patch checklist](https://kernelnewbies.org/FirstKernelPatch) that points at low-hanging fruit. Pick one issue. Resist the urge to fix ten things at once; a patch that does exactly one thing gets reviewed faster.

![A laptop computer viewed from above on a light wooden desk](/posts/submit-linux-kernel-patch/images/laptop-on-desk.jpg)

> **Citation capsule:** In the 7.1 release, 530 developers contributed to the kernel for the first time, with the staging tree and documentation topping the list of entry points (LWN.net, "Who Wrote 7.1", 2026). If you're looking for a place to start, run `checkpatch.pl` on the staging tree — every warning is a potential first patch.

## How Do You Set Up the Source Tree and Branch?

The kernel follows a roughly **9–10 week release cadence**: Linus Torvalds ships a new mainline version every 9–10 weeks, and stable maintainers backport fixes on top ([kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026). Clone the tree you intend to target — usually the latest stable or the subsystem maintainer's git tree. Create a dedicated topic branch for your change: `git checkout -b my-first-patch`. Never work directly on `master` or `main`. This branch holds exactly one logical change. If your fix touches multiple files, they all live in the same branch, but you'll commit them as separate, reviewable steps. A clean branch history is the first thing a maintainer checks.

![Line chart: developer count per kernel release, 6.12 to 7.1, grew from ~1,330 to 2,479 developers (LWN.net, 2026)](/posts/submit-linux-kernel-patch/chart-developers-line.svg)

The chart above tells a clear story: the kernel's contributor base has grown from roughly 1,330 developers per cycle in the 6.x base to 2,479 in 7.1 — an 85% increase in under two years. More contributors means more reviewers, more mentorship, and more paths in. You're joining at the busiest time in the project's history.

## How Do You Write the Change and the Commit Message?

Make your code change minimal and focused. Follow the [Linux Kernel Coding Style](https://www.kernel.org/doc/html/latest/process/coding-style.html): tabs for indentation (8-character tabs), 80-column lines, braces on the same line as the statement, and `goto` only for error cleanup. Then commit with `git commit -s` — the `-s` flag adds the mandatory `Signed-off-by:` line, certifying the [Developer Certificate of Origin](https://developercertificate.org). Anonymous contributions are not accepted. Your commit message needs a subsystem-prefixed subject line under 70–72 characters, a blank line, and a body wrapped at 72 characters explaining *why* the change matters. That subject line becomes the patch's global identifier in git history, so make it specific: `staging: rt8188eu: fix null-pointer check in init`.

Here's what a proper first-patch commit message looks like:

```
staging: rt8188eu: fix null-pointer check in rtw_init_drv_sw

The priv pointer returned by rtw_init_drv_sw() was not checked
before dereference in two error paths. Add the missing checks
and return -ENOMEM on failure, matching the surrounding code.

Signed-off-by: Your Name <you@example.com>
```

> **Citation capsule:** Every kernel patch must carry a `Signed-off-by:` line, added via `git commit -s`, certifying the Developer Certificate of Origin (kernel.org, "Submitting Patches", 2026). Anonymous or pseudonymous contributions are not accepted — the DCO is non-negotiable.

## Why Must You Run checkpatch.pl Before Sending?

`scripts/checkpatch.pl` is your first automated reviewer. In 2026, the Kernel Newbies tutorial recommends installing a **post-commit hook** that runs `checkpatch.pl --strict --codespell` after every commit ([Kernel Newbies, First Kernel Patch](https://kernelnewbies.org/FirstKernelPatch), 2026). The script reports three severity levels: ERROR (will likely get your patch rejected), WARNING (reviewers will flag these), and CHECK (style nits worth fixing). Run it against your file: `scripts/checkpatch.pl --file drivers/staging/yourfile.c`, or against a generated patch: `scripts/checkpatch.pl your.patch`. Fix every ERROR and WARNING before you think about sending. A patch that fails checkpatch is a patch that gets ignored.

<!-- [INFO-GAIN: personal experience] -->
A common first-timer trap: checkpatch flags `//` comments as errors because the kernel prefers `/* */`. It also rejects `typedef` for structure pointers and warns about `printk` calls without a log level. These aren't arbitrary — they're the rules that keep 33 million lines of code readable. Run checkpatch early, run it often, and let the post-commit hook catch regressions before they leave your machine.

![Lines of code cascading on a dark terminal background](/posts/submit-linux-kernel-patch/images/terminal-code.jpg)

## How Do You Generate the Patch File?

Once your commit is clean, generate the patch with `git format-patch -1 HEAD`. This creates a `.patch` file containing the diff, the commit message, and your sign-off — formatted exactly as a maintainer expects to read it. Inspect the file before sending: the subject line should carry a `[PATCH]` prefix, the body should explain the problem and the fix, and the `Signed-off-by` line must be present. If you're sending a series, use `git format-patch -n` (for n commits) and add a cover letter with `--cover-letter`. For a revision, use `--subject-prefix="PATCH v2"` and add a changelog after the `---` separator — that changelog is stripped when the patch is applied, but reviewers use it to see what changed.

## How Do You Send the Patch to the Right People?

This is where most newcomers stumble. Run `scripts/get_maintainer.pl your.patch` — it parses the MAINTAINERS file and outputs the exact `To:` and `CC:` list for your change. **Never guess the recipients, and never CC Linus Torvalds directly.** Then send with `git send-email`, not the Gmail web interface (which word-wraps your patch) or Outlook (which converts tabs to spaces). The [git-send-email.io](https://git-send-email.io/) tutorial walks through Gmail OAuth setup, Proton Mail pitfalls, and patch series threading. Configure your SMTP once, and `git send-email --to=maintainer@kernel.org your.patch` does the rest. Your patch will appear on [lore.kernel.org](https://lore.kernel.org) within minutes.

![A person working at a computer in a dark office lit by screen glow](/posts/submit-linux-kernel-patch/images/developer-workspace.jpg)

The kernel documentation mandates a **minimum one-week wait** before pinging a maintainer about an unreviewed patch; in practice, **2–3 weeks** is the normal review window during regular cycles ([kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026). When feedback arrives, reply inline (never top-post), address every comment, and resubmit as `[PATCH v2]`. Most first patches need 2–3 revision cycles — that's the process working, not a rejection.

> **Citation capsule:** The kernel's official submitting-patches guide requires a minimum one-week wait before following up on an unreviewed patch, with 2–3 weeks being the practical norm (kernel.org, "Submitting Patches", 2026). Use `get_maintainer.pl` to find recipients and `git send-email` to deliver — never the Gmail web interface.

Greg Kroah-Hartman, the kernel's stable-release maintainer, walks through this entire workflow in his Linux Foundation workshop. It's the closest thing to a canonical video guide:

<iframe
  srcdoc="<style>*{padding:0;margin:0;overflow:hidden}html,body{height:100%}img{width:100%;height:100%;object-fit:cover;border-radius:12px}</style><a href='https://www.youtube.com/watch?v=LLBrBBImJt4&autoplay=1'><img src='https://i.ytimg.com/vi/LLBrBBImJt4/maxresdefault.jpg' alt='Greg Kroah-Hartman: How to Submit Your First Patch to the Linux Kernel'></a>"
  src="https://www.youtube.com/embed/LLBrBBImJt4"
  title="Greg Kroah-Hartman: How to Submit Your First Patch to the Linux Kernel (Linux Foundation)"
  aria-label="Greg Kroah-Hartman: How to Submit Your First Patch to the Linux Kernel (Linux Foundation)"
  loading="lazy"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen
  style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px;margin:2rem 0">
</iframe>
<noscript><p style="margin:2rem 0"><a href="https://www.youtube.com/watch?v=LLBrBBImJt4">Watch on YouTube: Greg Kroah-Hartman — How to Submit Your First Patch to the Linux Kernel (Linux Foundation)</a></p></noscript>

## What Are the Most Common First-Patch Mistakes?

The single most frequent mistake is **trying to do too much in one patch**. A first-timer rewrites a driver's error-handling, renames variables, and switches an API — all in one changeset. Maintainers will ask you to split it. Other common failures: sending from the Gmail web interface (word-wrap destroys the patch), CCing Linus directly (he doesn't merge driver patches), omitting the `Signed-off-by` line, and top-posting replies on the mailing list. Each of these is an automatic credibility hit.

<!-- [INFO-GAIN: original observation] -->
Here's one you won't find in most guides: **don't submit during the merge window** unless your patch is a critical bugfix. The two-week merge window before a new mainline release is when maintainers queue their accepted patches for Linus. New submissions get lower attention. Wait until the merge window closes, then send — your patch lands when reviewers have bandwidth.

![Donut chart: first-time contributor subsystem distribution in kernel 7.1, Documentation 78, net 66, drivers/staging 47 (LWN.net, 2026)](/posts/submit-linux-kernel-patch/chart-first-timer-donut.svg)

## What Does Success Look Like?

If everything went right, your patch now sits on lore.kernel.org with a `[PATCH]` tag, addressed to the right maintainer, with a clean checkpatch run and a proper sign-off. Within 2–3 weeks, you'll get your first review — probably a request to split the change, fix a style nit, or explain a design choice. That's the process working. Respond, revise, resubmit. When a maintainer applies your patch, it flows into their tree, then into linux-next, then into the next mainline release. Your name joins the 22,000+ developers who've contributed to the kernel since the 2.6.x era.

## Frequently Asked Questions

### How long does it take to get a review back?

The kernel documentation mandates a minimum one-week wait; in practice, expect **2–3 weeks** during normal cycles ([kernel.org, "Submitting Patches"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), 2026). During the merge window, reviews slow down further. Don't ping before a week has passed.

### Can I use Gmail or Outlook to send my patch?

No. The Gmail web interface word-wraps long lines and destroys patch formatting; Outlook converts tabs to spaces. Both make your patch unapplyable. Use `git send-email` with an SMTP or OAuth setup — the [git-send-email.io](https://git-send-email.io/) tutorial covers Gmail OAuth configuration.

### What should I do if my patch gets rejected?

Read the feedback carefully. "Rejected" usually means "not ready yet" — fix the issues, bump the version to `[PATCH v2]`, and resubmit with a changelog. Most first patches go through 2–3 revision cycles before acceptance. That's normal.

### Do I need to subscribe to the LKML before submitting?

Yes. Subscribe to the relevant subsystem mailing list and the linux-kernel list first. Submitting without subscribing means you won't see replies — maintainers expect you to follow the thread. Use the list's archive on lore.kernel.org to find the right list.

### Is there a list of "good first patches" somewhere?

The [Kernel Newbies First Kernel Patch](https://kernelnewbies.org/FirstKernelPatch) page is the canonical starting point. Run `checkpatch.pl` on the staging tree for low-hanging fruit. In 2026, Documentation and the staging tree were the top two entry points for first-timers ([LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), 2026).

![Bar chart: non-merge changesets per kernel release, 6.12 to 7.1, 6.13 record at 19,314 (LWN.net, 2026)](/posts/submit-linux-kernel-patch/chart-changesets-bar.svg)

## Conclusion

You now have the full workflow: find a scoped issue in the staging tree or documentation, make a minimal change, commit with `git commit -s`, run `checkpatch.pl`, generate with `git format-patch`, find recipients with `get_maintainer.pl`, and send with `git send-email`. The 530 first-timers in kernel 7.1 proved the door is open. Your first patch won't be perfect — and that's fine. Submit it, learn from the review, and iterate. That's how every kernel developer started.

---

## Sources

- [LWN.net, "Who Wrote 7.1"](https://lwn.net/Articles/1077425), retrieved 2026-07-14
- [kernel.org, "Submitting Patches: the essential guide"](https://www.kernel.org/doc/html/latest/process/submitting-patches.html), retrieved 2026-07-14
- [Kernel Newbies, "First Kernel Patch"](https://kernelnewbies.org/FirstKernelPatch), retrieved 2026-07-14
- [kernel.org, "Linux Kernel Coding Style"](https://www.kernel.org/doc/html/latest/process/coding-style.html), retrieved 2026-07-14
- [git-send-email.io](https://git-send-email.io/), retrieved 2026-07-14
- [kernel.org releases](https://www.kernel.org), retrieved 2026-07-14
- [Linux Foundation Kernel Development Report](https://linuxfoundation.org), 2025
