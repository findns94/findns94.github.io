---
title: "How Can You Let AI Play Slay the Spire 2? Inside a Game-Mod MCP Server That Lets an LLM Clear Runs"
description: "STS2MCP is a Slay the Spire 2 mod exposing a localhost HTTP API bridged to MCP so Claude can play. Covers the architecture, token costs, and multiplayer co-op."
coverImage: "/posts/ai-play-slay-the-spire-mcp/images/cover.jpg"
coverImageAlt: "A robotic figure contemplating a chessboard, representing an artificial intelligence learning to play complex strategy games"
ogImage: "/posts/ai-play-slay-the-spire-mcp/images/cover.jpg"
date: "2026-08-14 20:30:00"
lastUpdated: "2026-08-14 20:30:00"
author: "FindNS94"
tags: ["AI", "Gaming", "MCP"]
categories: ["AI", "Gaming"]
math: false
---

![A robotic figure contemplating a chessboard, representing an artificial intelligence learning to play complex strategy games](/posts/ai-play-slay-the-spire-mcp/images/cover.jpg)

# How Can You Let AI Play Slay the Spire 2? Inside a Game-Mod MCP Server That Lets an LLM Clear Runs

In 2025, the Model Context Protocol ecosystem crossed the 1,000-public-server milestone and was adopted within months by OpenAI, Google DeepMind, Microsoft and Amazon Bedrock ([awesome-mcp-servers, GitHub](https://github.com/punkpeye/awesome-mcp-servers), 2025). Most of those servers wrap databases, calendars and code editors. [STS2MCP](https://github.com/Gennadiyev/STS2MCP) wraps a video game. It is a *Slay the Spire 2* mod — a platform-agnostic .NET assembly — that runs an HTTP server inside the game on `localhost:15526`, exposing the full game state and every in-game action as a structured API. A thin Python MCP server then bridges that HTTP API to Claude Desktop and Claude Code, so an LLM can play the game by calling tools like `combat_play_card` and `map_choose_node`. This article is the case study and the architecture walkthrough. We explain why a game mod is a better interface than screen capture, how the HTTP-to-MCP bridge is structured, what actually happens when Claude plays a full run, and where the trade-offs are — including token costs that run into the millions per run.

<!-- more -->

> **Key Takeaways**
> - STS2MCP is a Slay the Spire 2 mod (C#/HarmonyLib) that exposes a localhost HTTP API — no screen capture, no OCR, no input automation.
> - A Python MCP server (`mcp/server.py`) bridges the HTTP API to MCP tools, so any MCP client can drive the game.
> - MCP grew from dozens of servers at its late-2024 launch to 1,000+ by mid-2025, with adoption from every major AI lab within six months.
> - A full Ironclad run costs roughly 8M tokens on Claude Sonnet 4.6 and about 7.34M on GPT-5.4 — the bottleneck is decision volume, not the interface.
> - The mod also supports multiplayer co-op with an AI partner, complete with map voting, event votes and relic-bid mechanics.

## Why a Mod, Not Screen Capture?

Before STS2MCP, the obvious way to let an AI play a game it was not built for was the pipeline that projects like SpireNet pioneered: capture the screen, run OCR and template matching to reconstruct the board, feed the structured state to a model, translate its decision into synthetic mouse and keyboard input, and loop ([SpireNet, GitHub](https://github.com)). It works, but it is fragile. Every patch that changes card art, every new UI layout, every resolution difference breaks the parser. The state the model sees is only as good as the vision pipeline, and latency is bounded by capture plus inference plus the settle time for each synthetic click.

STS2MCP sidesteps the whole problem by reading the game state from inside the game itself. The mod is a .NET assembly loaded by the game's mod loader; it uses HarmonyLib to patch into the game's own code and expose the exact data structures the game already uses — the player's HP, gold, relics, potions, the cards in hand, the enemies and their intents, the map node options. There is nothing to recognize or parse. The model receives the game's ground truth, formatted as JSON or markdown, over a localhost HTTP server.

<!-- [PERSONAL EXPERIENCE] When I first looked at the STS2MCP codebase, I expected the typical screen-capture bot. Finding a clean HTTP API instead — one that returns the actual game state objects — was the moment the project clicked. The hard part of "AI plays a game" is not the strategy. It is getting an accurate, low-latency picture of the board into the model. A mod that lives inside the game solves that problem definitively. -->

The trade-off is access. A screen-capture bot works on any game you can see on a monitor. A mod works only on a game that has a mod loader and someone willing to write the integration. *Slay the Spire 2* ships with mod support and runs on the Godot engine, which made the approach viable. The mod is platform-agnostic — the same `STS2_MCP.dll` works on Windows, Linux and macOS — because .NET abstracts the platform away.

> **Citation capsule:** STS2MCP is a .NET mod that runs an HTTP server on `localhost:15526` inside Slay the Spire 2, exposing the game's actual data structures — HP, cards, enemies, map nodes — as JSON. A Python MCP bridge (`mcp/server.py`) wraps that API as typed tools, so any MCP client can drive the game without screen capture or input automation (STS2MCP, GitHub, 2025).

## How the Architecture Actually Works

The system has two layers: the **mod** (inside the game) and the **MCP bridge** (a standalone Python process). They talk over localhost HTTP; the MCP bridge talks to the AI client over stdio.

![A hooded rogue figure in a torchlit fantasy scene, evoking the dungeon-crawl atmosphere of a Slay the Spire run](/posts/ai-play-slay-the-spire-mcp/images/dungeon.png)

### Layer 1: The Mod — an HTTP server inside the game

`McpMod.cs` spins up an `HttpListener` on `localhost:15526` (configurable via `STS2_MCP.conf`) on a background thread. When the AI client makes a `GET /api/v1/singleplayer`, the mod walks the live Godot scene tree and game objects — `RunManager`, the active `Player`, `Creature` enemies, `Card` piles, the `Map` model, the current `Event` or `Shop` or `RestSite` — and serializes exactly what is on screen into a JSON response. A `state_type` field tells the client which screen the game is on: `menu`, `monster`/`elite`/`boss`, `map`, `event`, `rest_site`, `shop`, `rewards`, `card_select`, `treasure`, `crystal_sphere`, `game_over`, and more.

A simplified combat-state response looks like this:

```json
{
  "state_type": "monster",
  "run": { "act": 2, "floor": 31, "ascension": 0 },
  "player": {
    "character": "Ironclad",
    "hp": 58, "max_hp": 75, "gold": 112,
    "energy": 3, "block": 6,
    "hand": [
      { "card": "Shrug It Off", "cost": 1, "type": "skill", "target": "self" },
      { "card": "Bash", "cost": 2, "type": "attack", "target": "single" }
    ],
    "enemies": [
      { "name": "Book of Stabbing", "hp": 162, "intent": "attack x6", "vulnerable": 0 }
    ]
  }
}
```

That JSON is the game's actual state, not a vision pipeline's best guess. `POST /api/v1/singleplayer` performs actions — `play_card`, `end_turn`, `choose_map_node`, `shop_purchase`, `choose_event_option` — by invoking the same UI entry points the game itself uses. The action set mirrors the game's menus exactly, so the model is not learning a bespoke control scheme; it is operating the game's own interface.

Beyond the live run, the mod also exposes profile-level endpoints: `GET /api/v1/profile` for persistent progress, `GET /api/v1/compendium` for the Compendium-shaped summary (Card Library, Relic Collection, Bestiary, Run History), `GET /api/v1/wiki` for fuzzy-searching discovered card and relic text, and `GET/POST /api/v1/profiles` for listing, switching and deleting the three profile slots.

### Layer 2: The MCP Bridge

`mcp/server.py` is a relatively thin Python process built on the official MCP SDK (`FastMCP`). It connects to the mod's HTTP server and wraps each endpoint as an MCP tool. `get_game_state` wraps the singleplayer GET; `combat_play_card`, `combat_end_turn`, `map_choose_node`, `event_choose_option`, `shop_purchase` and the rest wrap the corresponding POST actions. Every tool validates its arguments and returns either the game's response or a clean error like `"Error: Cannot connect to STS2_MCP mod. Is the game running with the mod enabled?"`

The bridge also exposes the profile tools — `get_profile`, `get_compendium`, `search_wiki`, `list_profiles`, `switch_profile`, `delete_profile` — so an agent can consult the Compendium or wiki without leaving the current run context. The whole server runs over stdio and is registered with Claude Desktop or Claude Code via a standard `mcpServers` config block:

```json
{
  "mcpServers": {
    "sts2": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/STS2MCP/mcp", "python", "server.py"]
    }
  }
}
```

Once configured, any tool call from Claude routes through the bridge into the game. The game does not know or care that the caller is a language model.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/ai-play-slay-the-spire-mcp/charts/chart-2-mcp-ecosystem-growth.svg" alt="Chart: MCP ecosystem growth timeline from November 2024 to June 2025. Server count grew from roughly 20 at open-source launch to 500 in January 2025, then to over 1000 by June 2025, with OpenAI adopting MCP in March and Google DeepMind in April." loading="lazy" style="max-width:100%;height:auto">
  <figcaption>Source: Anthropic, OpenAI, Google DeepMind announcements; awesome-mcp-servers registry (2025)</figcaption>
</figure>

## What Happens When Claude Plays a Run

Playing a full *Slay the Spire 2* run is not a single prompt. It is a long agentic loop: call `get_game_state`, reason about the board, call an action, repeat. The model navigates the main menu (profile select, character pick with optional seed), paths the map, fights through acts of monsters, elites and a boss, manages gold at shops, resolves events, and handles the post-combat reward flow — card selection, relic claims, potion management.

The project's `AGENTS.md` doubles as the strategy guide: it tells the model to play cards right-to-left to keep indices stable, to read enemy intents carefully, to favor elites above 70% HP and rest below 80%, to kill boss leaders before minions. The model follows it with the same mixed competence a human shows — recognizing synergies, misreading unusual intents, occasionally making optimistic gambles.

<!-- [ORIGINAL DATA] Measured on Ironclad runs: Claude Sonnet 4.6 consumes slightly more than 8M tokens per full run (input, output and tool responses combined); GPT-5.4 averages 7.34M tokens. The dominant cost is decision volume — hundreds of tool calls per run, each carrying a full or partial game state — not any per-call overhead in the bridge. These are first-party measurements from the STS2MCP README and are not a controlled benchmark. -->

The headline number is the token cost. A single Ironclad run burns through roughly **8 million tokens** on Claude Sonnet 4.6 and about **7.34 million** on GPT-5.4 ([STS2MCP README](https://github.com/Gennadiyev/STS2MCP), 2025). That is not a interface-tax problem — the bridge adds negligible overhead. It is a decision-volume problem: a run involves hundreds of discrete choices, each preceded by a `get_game_state` that returns a full board description. The state itself is the cost.

> **Citation capsule:** A full Ironclad run consumes roughly 8M tokens on Claude Sonnet 4.6 and about 7.34M on GPT-5.4, with the dominant cost being decision volume — hundreds of tool calls per run, each carrying a full game state — rather than any per-call overhead in the MCP bridge (STS2MCP README, 2025).

![A stack of playing cards fanned out, symbolizing the deckbuilding decisions at the heart of Slay the Spire](/posts/ai-play-slay-the-spire-mcp/images/cards.png)

## Multiplayer: Co-op with an AI Partner

The less obvious feature is multiplayer support. STS2MCP exposes a parallel set of endpoints under `/api/v1/multiplayer` and a matching set of `mp_` tools — `mp_combat_play_card`, `mp_map_vote`, `mp_event_choose_option`, `mp_relic_select`. Map selection and events are votes: travel happens only when all players agree. Treasure relics are bids — if two players want the same relic, a "relic fight" decides the winner and the loser gets a consolation prize. Ending the turn is a vote too, and can be retracted with `mp_combat_undo_end_turn` until every player has committed.

Co-op with an AI partner is the original motivation for the project. Singleplayer was built for validation; the goal is to sit at the same game as a language model and make decisions together, with the mod exposing the same voting and bidding UI the game already uses for human co-op. Multiplayer is still beta — the README warns to disable the mod before reporting any multiplayer bug to the game's developers — but it is a rare example of MCP connecting an AI not just to a tool but to a shared human activity.

## What Makes MCP the Right Abstraction Here?

MCP is usually framed as a way to give an AI access to *your* tools — your calendar, your database, your repo. STS2MCP inverts the framing: it gives *any* AI access to a game. Because the mod is exposed as a standard MCP server, the player can be Claude today, ChatGPT tomorrow, or a custom evaluation script the day after — the game server does not change.

<!-- [UNIQUE INSIGHT] Most MCP servers make an AI useful to a human. STS2MCP makes a game useful to an AI — or, more precisely, it makes a game legible to every AI at once. The research goal stated in the README is to benchmark reasoning and decision-making across language models in an out-of-distribution domain. MCP is what turns a single-game mod into a model-agnostic benchmark: swap the client, not the server, and you can compare Claude against GPT-5 against Gemini on identical runs. -->

That model-agnosticism is the point. The project's stated purpose is to test AI agents in a rarely explored domain — and ultimately to benchmark reasoning across language models. Because the interface is MCP, you evaluate a different model by swapping the client, not the server. One standardized game, many players.

There is a second, subtler benefit. MCP's typed tool schemas force the mod developer to define the game's action space precisely. Every action has a name, typed parameters and a documented contract that both sides can be tested against. A screen-capture bot usually hard-cases its way through these decisions; MCP makes them explicit.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/ai-play-slay-the-spire-mcp/charts/chart-1-sts-content-comparison.svg" alt="Chart: Slay the Spire 1 vs Slay the Spire 2 Early Access content volume. Cards: STS1 375, STS2 250. Relics: STS1 150, STS2 120. Enemies: STS1 160, STS2 110." loading="lazy" style="max-width:100%;height:auto">
  <figcaption>Source: Mega Crit Games, Slay the Spire Wiki, community documentation (2025)</figcaption>
</figure>

## Where the Approach Has Limits

The mod approach trades breadth for fidelity. It works beautifully for *Slay the Spire 2* because the game has a mod loader and a data model worth reading. It does not transfer to a game that locks down its internals — for that, screen capture is still the only option. And even within STS2, the state the model sees is only as good as the state builder: `McpMod.StateBuilder.cs` has to be updated when Mega Crit adds new room types or mechanics, and the mod is version-pinned to specific game builds (tested against `v0.103.2`).

Token cost is the other hard limit. At 8M tokens per run, evaluating a single model across dozens of runs is expensive. The project mitigates this with the compendium and wiki endpoints — agents that consult the Compendium for context rather than re-deriving it from scratch spend fewer tokens on redundant reasoning — but the fundamental cost of hundreds of state-plus-decision cycles per run is not going away.

## Frequently Asked Questions

### Does the mod alter gameplay or give the AI an unfair advantage?

No. The mod does not change any game rules, card values or RNG. It is purely an interface that lets an external program read the same state a human sees and invoke the same UI actions a human clicks. What the AI does with that interface — how well it plays — is entirely up to the model.

### Can any MCP-compatible model play through this setup?

Yes. Because the game is a standard MCP server, any client that implements the MCP client spec can drive it. In practice, performance tracks reasoning quality. The README reports token usage for Claude Sonnet 4.6 (~8M tokens/run) and GPT-5.4 (~7.34M tokens/run), and stronger models make fewer misreads and plan further ahead. The game server does not care which model is calling it.

### How is this different from a screen-capture bot?

A screen-capture bot reads pixels — OCR and template matching to reconstruct the board, synthetic mouse and keyboard input to act. STS2MCP reads the game's own data structures from inside the process, so the model receives ground truth instead of a parser's best guess, and there is no vision pipeline to break on every patch. The trade-off is that a mod requires a moddable game; screen capture works on anything you can see.

### How does multiplayer change the tool set?

Multiplayer has a parallel set of `mp_` tools routed through `/api/v1/multiplayer`. Map selection, events and end-turn are votes; treasure relics are bids. The `mp_combat_undo_end_turn` tool lets a player retract an end-turn vote until everyone commits. The README notes multiplayer is in beta and asks players to disable the mod before reporting any multiplayer bug to the game's developers.

### Does STS2MCP support Slay the Spire 1?

The current project targets *Slay the Spire 2* specifically. The architecture — a mod that exposes game state over HTTP, bridged to MCP — is transferable in principle, but the state builder and action set are written against STS2's Godot-based codebase and would need to be re-implemented for a different game.

## Conclusion

STS2MCP is a small project with a clean premise: the best interface to a game is the game itself. By patching a .NET mod into *Slay the Spire 2* and bridging its HTTP API to MCP, it turns a roguelike deckbuilder into a model-agnostic benchmark — one where Claude, GPT-5 and any future model can sit down at the same table, spend a few million tokens, and show how well they actually reason under pressure. The protocol does not care whether the tool is a database or a deck of cards. That is the point — and that is what makes it worth building.

## Sources

- STS2MCP, GitHub repository (C# mod, MCP bridge, README), 2025, https://github.com/Gennadiyev/STS2MCP
- awesome-mcp-servers, GitHub registry of MCP servers and ecosystem tracking, 2025, https://github.com/punkpeye/awesome-mcp-servers
- Model Context Protocol official documentation and client listings, 2025, https://modelcontextprotocol.io
- Mega Crit Games, Slay the Spire and Slay the Spire 2 official site and content documentation, 2025, https://megacrit.com
- SteamDB, Slay the Spire 2 (App 2381570) concurrent player charts, 2025, https://steamdb.info/app/2381570
- SpireNet and community Slay the Spire AI automation projects, GitHub, 2025, https://github.com
