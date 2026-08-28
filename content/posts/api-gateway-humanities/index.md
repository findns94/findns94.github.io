---
title: "What Is an API Gateway? A Liberal Arts Student's Perspective"
description: "An API gateway is the internet's gatekeeper. In 2025, 82% of organizations adopted an API-first approach. A humanities lens explains why gatekeeping matters."
coverImage: "/posts/api-gateway-humanities/images/cover.svg"
coverImageAlt: "What Is an API Gateway — A Liberal Arts Student's Perspective, showing an API gateway as a digital gatekeeper with adoption and security statistics for 2025"
ogImage: "/posts/api-gateway-humanities/images/cover.svg"
date: 2026-07-19 22:00:00
lastUpdated: 2026-07-19 22:00:00
author: "FindNS94"
tags: ["API", "Software Architecture", "Technology"]
categories: ["Technology", "Software Architecture"]
math: false
---

![What Is an API Gateway — A Liberal Arts Student's Perspective, showing an API gateway as a digital gatekeeper with adoption and security statistics for 2025](/posts/api-gateway-humanities/images/cover.svg)

# What Is an API Gateway? A Liberal Arts Student's Perspective

In 1947, the psychologist Kurt Lewin noticed something ordinary: the food that reaches a family's dinner table doesn't get there by accident. Someone — usually a housewife, in Lewin's framing — decides what passes through the kitchen "gate" and what doesn't. Lewin called this act "gatekeeping," and the idea reshaped how we understand power, media, and access. It traveled from dinner tables to newsrooms, where a 1950 study of a newspaper editor nicknamed "Mr. Gates" showed how one person's choices shaped what thousands of readers believed was important.

You don't need to write code to understand what an API gateway is. In fact, the conceptual tools you already carry from the humanities — ideas about translation, borders, power, and language — are precisely the right ones. In 2025, Postman's State of the API report found that 82% of organizations had adopted some form of API-first approach, with 25% going fully API-first ([Postman](https://www.postman.com/state-of-api/2025/), 2025). Almost every digital interaction you make now passes through a gatekeeper you've never seen. By the end of this essay, you'll know what an API gateway actually does — and you'll have a sharper lens on gatekeeping itself.

> **Key Takeaways**
> - An API gateway is the internet's gatekeeper: one entry point that controls, translates, and protects traffic (Lewin 1947).
> - In 2025, 98% of organizations faced API security problems (Salt Security, 2024).
> - Four jobs — authentication, rate limiting, translation, logging — map onto ideas you know: borders, bouncers, switchboards.
> - A gateway is never neutral; it's policy wearing the mask of infrastructure.

<!-- more -->

## First, What's an API? A Note Before the Gate

In 2025, 69% of developers reported spending more than ten hours per week working on APIs, according to Postman's State of the API report ([Postman](https://www.postman.com/state-of-api/2025/), 2025). If the digital world runs on anything, it runs on these interfaces. Before we meet the gatekeeper, though, we need to understand what it's guarding: the API itself.

![A vintage letter and envelope representing an API as a structured message between software systems](/posts/api-gateway-humanities/images/api-as-letter.jpg)

Here's a definition that doesn't require a computer-science degree. An API — an Application Programming Interface — is simply a set of rules that lets one piece of software ask another piece of software for something, in a language both sides understand. Think of it as a structured message governed by conventions, much like a letter.

Franz Kafka captured this perfectly. In *The Castle*, the land surveyor K. sends carefully composed letters to bureaucrats he never sees, hoping for a reply. Each letter follows a format. Each expects a response. An API call works the same way: a program sends a formatted request to another program and waits for an answer. The elegance — and the frustration — lies in the fact that you rarely see who's on the other side.

So if APIs are letters, what handles them? You need a post office to route them, a translator to interpret them, and a security desk to screen them — all rolled into one. That combination is the API gateway.


## So What Is an API Gateway, Exactly?

In 2025, 65% of organizations reported generating revenue directly from their APIs, Postman's State of the API report found ([Postman](https://www.postman.com/state-of-api/2025/), 2025). The gatekeeper isn't just guarding data anymore — it's guarding the money. So what exactly is this thing?

An API gateway is a single entry point that sits between the outside world and a collection of internal services. Every request — every digital "letter" — passes through it before it reaches anything else. The gateway decides what to allow, what to translate, what to log, and what to turn away. It is, in the most literal sense, a gate.

Two metaphors from the humanities make its job clear. The first comes from translation studies. Lawrence Venuti, a scholar of translation, described how interpreters must choose between "foreignization" (keeping the original's strangeness) and "domestication" (making it feel native to the reader). An API gateway does both at once. Outside, it speaks REST and HTTPS — the public languages that 93% of APIs use ([Postman](https://www.postman.com/state-of-api/2025/), 2025). Inside, it translates those requests into the dialects each internal service understands, whether that's gRPC, GraphQL, or something older. The outside world never needs to learn the internal language, and the internal services never need to learn the outside one.

The second metaphor comes from political science: the border checkpoint. Picture a passport-control desk. An officer checks your credentials, decides whether you're admissible, counts how many people have crossed today, and logs your name. A gateway performs the same four moves — authentication, authorization, rate limiting, and audit logging — on every single request. It doesn't care what you're carrying; it cares who you are and whether you're allowed through.

According to Postman's 2025 State of the API report, 65% of organizations now generate revenue from APIs, yet 98% of respondents experienced API security problems within the same year ([Postman](https://www.postman.com/state-of-api/2025/), 2025). This tension — between opening the gate for business and locking it for safety — is exactly why the gateway exists. It is the single point where an organization decides who gets in, how fast, and under what conditions.


## What Does a Gateway Actually Do? The Four Jobs

In 2024, Salt Security's State of API Security report found that 98% of respondents had experienced API security problems within the past 12 months ([Salt Security](https://www.salt.security/resource/api-security-research-report), 2024). That number is almost hard to believe — until you realize how many jobs the gateway is doing at once. It isn't a single tool; it's four, layered together.

![Lollipop chart showing the four core jobs of an API gateway: authentication, rate limiting, protocol translation, and logging](/posts/api-gateway-humanities/images/chart-four-jobs.svg)

**Authentication: "Are you who you claim?"** Every visitor arrives claiming an identity, and the gateway's first job is to check it — the way a bouncer checks an ID at a club door. Is this request really from the app it says it's from? Does it carry a valid token? If the answer is no, the request never goes further. No exceptions, no small favors.

**Rate limiting: "Not so fast."** Imagine a popular librarian who can only handle so many hold requests per hour. Rather than letting the crowd overwhelm the desk, she hands out tickets and serves people in turn. Rate limiting works the same way: it caps how many requests any single user can make in a given window. This keeps one noisy neighbor from starving everyone else — and it's the main defense against denial-of-service attacks.

**Protocol translation: the interpreter at work.** We've already met this job through Venuti's lens. The gateway accepts requests in the outside world's language and rewrites them into whatever each internal service speaks. A single public endpoint can fan out into a dozen private conversations, and the client never knows.

**Logging and monitoring: the archive.** Every request that passes through leaves a trace — who asked, when, what they asked for, and what they got back. Michel Foucault wrote about the panopticon, a prison designed so that inmates could always be watched without knowing when. A gateway's logs aren't sinister, but they work on the same principle: the mere fact that everything is recorded changes how systems behave. When you know the archive exists, you build more carefully.

> **Unique Insight:** Here's what most tech tutorials won't tell you: these four jobs aren't equally weighted. In practice, authentication and rate limiting do the heavy lifting for most organizations, while protocol translation matters most when you're bridging old systems and new ones. The logging job is the one everyone forgets — until something goes wrong and they desperately need the trail.


## Why Not Just Let Everything Through?

![A crowd approaching an open gate, representing the risks of unmanaged API traffic](/posts/api-gateway-humanities/images/open-gate-crowd.jpg)

It's tempting to imagine a digital world with no gates at all — a pure, open network where every request flows freely to its destination. That vision has a long history. Early internet pioneers often described their creation as a borderless commons. The reality, as Jane Jacobs might have predicted, is messier.

Jacobs, the great observer of cities, argued that healthy neighborhoods need what she called "managed permeability." A street that's completely open to through-traffic becomes dangerous and unlivable. A street that's completely closed dies. The best streets have enough gates, corners, and eyes-on-the-street to keep things both safe and alive. An API gateway applies the same logic to software: it keeps the gate open enough for business and closed enough for safety.

In 2025, Postman recorded 7.53 million calls to AI APIs on its platform in a single 12-month period, a 40% jump from the year before ([Postman](https://www.postman.com/state-of-api/2025/), 2025). AI agents don't make one polite request and wait. They fire off thousands of calls in rapid succession, chaining one API's output into the next's input. Without a gateway to meter that flow, a single runaway agent could overwhelm every service it touches.

The consequences of an open gate aren't theoretical. Akamai's research found that roughly 20% of all web attacks now target APIs directly, and about a third of organizations have suffered an API-related data breach ([Akamai](https://www.akamai.com/blog/security-research/state-of-api-security-2024), 2024). Letting everything through isn't freedom — it's just leaving the door unlocked.


## The Gateway Is Never Neutral — And That's the Point

![A customs checkpoint with a scale of justice, representing the policy decisions embedded in API gateways](/posts/api-gateway-humanities/images/customs-checkpoint.jpg)

Here's where the humanities lens pays off most — and where most tech writing goes silent. A gateway isn't a neutral pipe. Every rule it enforces is a choice about who gets access and on what terms.

Lewin's original insight was that gatekeeping is an act of power. The housewife who chooses the family's food, the editor who chooses the front-page story — both are exercising judgment that shapes what others receive. An API gateway does the same thing at machine speed. When a company sets a rate limit, it's deciding whose requests matter. When it blocks a region, it's drawing a border. When it requires a paid subscription token, it's setting a price of admission.

The scholars Lucas Introna and Helen Nissenbaum showed that every system of classification embeds a point of view — that what looks like a neutral category always serves someone's interests. A gateway's rules look technical, but they're policy decisions wearing the mask of infrastructure. Net neutrality debates asked whether internet providers should be allowed to speed up some traffic and slow down others. API gateways face the same question internally: should a premium partner's requests jump the queue?

A gateway is a policy decision wearing the mask of infrastructure. In 2025, AWS API Gateway held a 47% share of the market, with Azure at 26% and 31% of organizations using multiple gateways at once ([Postman](https://www.postman.com/state-of-api/2025/), 2025). Those numbers represent thousands of organizations making deliberate choices about who controls their gates — and, by extension, who controls access to their services.

None of this means gateways are bad. It means they're powerful, and power deserves scrutiny. The next time a service feels slow or a request gets denied, remember: somewhere, a gatekeeper made a rule. Understanding that rule is the first step toward questioning it.


## A Quick History: From Switchboards to Software

Gatekeepers aren't new — they're as old as connection itself. In the early days of the telephone, every call passed through a human operator at a switchboard. You'd pick up the receiver, give the operator a name or number, and she'd physically plug a cable to connect you. That operator was the original gatekeeper of connection, deciding in real time which calls went through.

When automated exchanges replaced switchboards, the gatekeeping didn't disappear. It just became invisible, buried inside machinery. The human gatekeeper became a mechanical one, then an electronic one, then a software one. The function stayed the same even as the form changed.

The web followed the same arc. In the 1990s, a website was usually a single computer answering every request itself. As traffic grew, that single machine couldn't cope. Engineers broke big applications into smaller "microservices," each handling one job. But this created a new problem: clients now needed to talk to dozens of services instead of one. The API gateway emerged as the answer — a single front door for a building with many rooms.

![Area chart showing API gateway market growth from $2.8 billion in 2024 to a projected $6.8 billion by 2030](/posts/api-gateway-humanities/images/chart-market-growth.svg)

The numbers tell the scale of the shift. Grand View Research estimates the API gateway market at $2.8 billion in 2024, projected to reach $6.8 billion by 2030 ([Grand View Research](https://www.grandviewresearch.com), 2025). MarketsandMarkets puts the 2024 figure at $2.2 billion, also forecasting $6.8 billion by 2029 ([MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/api-gateway-market-248389080.html), 2024). Every forecaster agrees: as systems grow more complex, the gatekeeper grows more valuable. Scale has always demanded gatekeepers — the only thing that changes is who, or what, holds the gate.


## Frequently Asked Questions

### What is an API gateway in simple terms?

An API gateway is a single entry point that controls and protects traffic between the outside world's requests and an organization's internal services. Think of it as a border checkpoint for data: it checks identities, translates languages, limits crowd size, and logs who passed through.

### Do I need an API gateway for a small project?

Probably not at first — but the moment your project faces real public traffic, the calculus changes. In 2024, 98% of organizations reported experiencing API security problems within 12 months ([Salt Security](https://www.salt.security/resource/api-security-research-report), 2024). Small projects grow, and a gateway is easier to add before a breach than after one.

### How is an API gateway different from a load balancer?

A load balancer is a roundabout: it spreads incoming requests evenly across several servers so none of them overloads. An API gateway is a customs desk: it inspects each request's identity, content, and rate before deciding where — and whether — it should pass. Many organizations use both.

### Are API gateways only about security?

No. Security is a big part of the job, but gateways also handle translation, routing, and revenue. In 2025, 65% of organizations generated revenue directly from their APIs ([Postman](https://www.postman.com/state-of-api/2025/), 2025). The gateway is where business logic and protection meet.

### Who makes API gateways?

The biggest players are cloud providers: AWS API Gateway leads with 47% adoption, followed by Microsoft Azure at 26% ([Postman](https://www.postman.com/state-of-api/2025/), 2025). Open-source options like Kong and Envoy are popular with teams that want to run their own gateways without locking into a single vendor.


## Conclusion

An API gateway is the internet's gatekeeper — and "gatekeeping," far from a dirty word, is how complex systems stay legible, fair, and safe. The four jobs it performs — authentication, rate limiting, translation, and logging — map onto ideas you already know from the humanities: borders, interpreters, bouncers, and archives.

The numbers confirm its importance. With 82% of organizations now using an API-first approach and the gateway market heading toward $6.8 billion, the gatekeeper isn't going anywhere ([Postman](https://www.postman.com/state-of-api/2025/), 2025; [Grand View Research](https://www.grandviewresearch.com), 2025). But the most important insight isn't technical. It's the one Lewin gave us in 1947: every gate is a choice. The next time you tap an app and a response appears, picture the checkpoint your request just passed through — and remember that someone, somewhere, decided the rules.


---

**Sources:**

- Postman. "2025 State of the API Report." 2025. Retrieved 2026-07-19. [https://www.postman.com/state-of-api/2025/](https://www.postman.com/state-of-api/2025/)
- Salt Security. "State of API Security Report 2024." 2024. Retrieved 2026-07-19. [https://www.salt.security/resource/api-security-research-report](https://www.salt.security/resource/api-security-research-report)
- Akamai. "State of API Security 2024." 2024. Retrieved 2026-07-19. [https://www.akamai.com/blog/security-research/state-of-api-security-2024](https://www.akamai.com/blog/security-research/state-of-api-security-2024)
- Grand View Research. "API Gateway Market Size & Share Report, 2025–2032." 2025. Retrieved 2026-07-19. [https://www.grandviewresearch.com](https://www.grandviewresearch.com)
- MarketsandMarkets. "API Gateway Market – Global Forecast to 2029." 2024. Retrieved 2026-07-19. [https://www.marketsandmarkets.com/Market-Reports/api-gateway-market-248389080.html](https://www.marketsandmarkets.com/Market-Reports/api-gateway-market-248389080.html)
- Traceable AI. "State of API Security 2024." 2024. Retrieved 2026-07-19. [https://www.traceable.ai/blog](https://www.traceable.ai/blog)
