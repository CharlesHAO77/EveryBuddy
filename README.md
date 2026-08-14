# EveryBuddy

**Your personal desktop AI agent — built for everyone.**

A local-first, open-source alternative to **OpenAI Codex** and **WorkBuddy**. Chat with a capable agent that reads your code, edits your files, runs your commands, sees your images, generates pictures, and handles routine tasks on a schedule — all on your own machine, with your own API keys.

- [简体中文](README.zh-CN.md) · [Requirements](docs/requirements.md) · [Architecture](docs/architecture.md) · [Agent SDK](docs/pi-coding-sdk.md)

![EveryBuddy welcome screen](docs/screenshots/welcome.png)

---

## Highlights

- 🧑‍💼 **Built for everyone** — not just developers. Two built-in personas cover daily office work (docs, tables, planning) and coding (read, edit, run, explore); create your own.
- 🌐 **Open-source alternative to Codex / WorkBuddy** — local-first and self-hosted, with no subscription lock-in.
- 🖼️ **Truly multimodal** — language models + **vision** tools (understand and describe images) + **image generation** tools, coordinated by the agent.
- 💰 **Save on AI costs** — bring your own API key, pay per use instead of a subscription, and see **real token/cost per message**, split by LLM / VLM / Image.
- ⏰ **Automation** — schedule prompts with cron, presets, or one-shot; track run history and cost; get notified on completion.
- 🧑‍🔬 **Experts & teams** — reusable personas with per-capability model routing, grouped into teams for one-click switching.
- 🛠️ **Skills** — install, write, and toggle `SKILL.md` skill packs; auto-discover anything you drop in.
- 🔌 **Custom connectors** — plug external capabilities in over **MCP** (stdio or Streamable HTTP), test connections, and bind them to experts.
- 🏢 **Customizable for individuals and teams** — experts, skills, connectors, and a tag system give you a desktop agent tailored to your way of working.
- 🔒 **Private by design** — keys live only in the OS keychain, the renderer never sees them; destructive tools ask for confirmation; file access is sandboxed to your workspace.

---

## Why EveryBuddy?

**It's your agent, not a vendor's.** EveryBuddy runs on your desktop and keeps your code, sessions, and configuration on your machine. You bring the model API keys, so you only pay for what you use — no monthly subscription, no cloud data egress, no lock-in. The cost of every run is right there in the conversation footer.

| | EveryBuddy | Codex / WorkBuddy |
| --- | --- | --- |
| **Model cost** | Your own API key, pay-per-use | Subscription |
| **Data location** | Local-first (`~/EveryBuddy`) | Vendor cloud |
| **Open source** | ✅ | ❌ |
| **Multi-model** | Any OpenAI-compatible endpoint, typed LLM / VLM / Image | Vendor-managed |
| **Customization** | Experts, teams, skills, MCP connectors, tags | Limited |

---

## Features

### A personal agent for everyone

Two built-in experts get you started immediately — **办公助理** (Office Assistant) for documents, tables, and everyday tasks, and **编码助手** (Coding Assistant) for reading and modifying code, running commands, and exploring projects. Add your own experts with custom system prompts, tool sets, and per-capability model routing (chat / vision / image-gen).

### Multimodal: language + vision + image generation

- **Vision** — the agent calls `understand_image` to describe or answer questions about images. When your chat model can't take image input, EveryBuddy automatically routes the picture to a configured **VLM** and injects the description as text.
- **Image generation** — the agent calls `generate_image` against any OpenAI-compatible `/images/generations` endpoint (e.g. 豆包 ARK, SiliconFlow, OpenAI), saving results to the workspace.

### Transparent, cost-saving billing

Every AI message footer shows the real token count and cost (¥), aggregated by model type — **LLM / VLM / Image** — for both **this run** and **this session**. Know exactly what a task cost before committing to a workflow, and pick cheaper models without losing capability.

### Scheduled automation

Automate recurring or one-off prompts: **preset** (hourly/daily/weekly/monthly), **5-field cron**, or **one-shot** ("in 30 minutes"). Each run streams its result, records usage and cost in a run-history list, and can fire a system notification when done.

### Experts & expert teams

Experts are reusable agent personas. Group them into **teams** for one-click switching between working setups. Team dispatch and workflow orchestration (multi-agent) are on the roadmap, with the schema already reserved.

### Skill management

Skills are reusable instruction packs in the `SKILL.md` format (invoked with `/name`). Browse what's installed, import skill packages locally, write your own with a built-in editor, and toggle them on/off. New folders dropped into `skills/` are auto-discovered.

### Custom connectors (MCP)

Connect external capabilities over the **Model Context Protocol** — `stdio` for local servers (including managed `npm install` of MCP server packages) or **Streamable HTTP** for remote endpoints, with auto transport detection. Test a connection to list its tools, then bind the connector to the experts that need it. HTTP API / datasource / custom connector types are registered and reserved for the roadmap.

### Private and secure

- API keys are entered via the native OS dialog and stored in the system keychain — **the renderer process never reads a key**.
- All IPC is validated with Zod; the main process trusts nothing from the UI.
- Destructive tools (`write` / `edit` / delete / `bash`) require confirmation, with per-workspace allowlists.
- File access is sandboxed to your selected workspace; `..` and symlink escapes are blocked.

---

## Screenshots

![Agent conversation — tool call, markdown result, and per-run cost](docs/screenshots/chat.png)

![Expert center — manage experts, teams, skills, and connectors](docs/screenshots/expert-center.png)

![Automation — scheduled tasks with run history and cost](docs/screenshots/automation.png)

Interactive UI prototypes: [Expert · Skill · Connector](docs/demos/expert-skill-connector.html) · [Automation](docs/demos/automation.html) · [Chat experience](docs/demos/dialog-experience.html)

---

## Quick start

> **Status:** early-stage, actively developed. Requires **Node.js 20+** and **npm 10+**.

```bash
npm install      # install dependencies
npm run dev      # launch the desktop app
```

Then, in the app:

1. Open **设置 → 模型设置** and add at least one **LLM** provider (any OpenAI-compatible endpoint — e.g. OpenAI, DeepSeek, OpenRouter, 豆包 ARK). Add a **VLM** for vision and an **Image** model for image generation as you need them.
2. Choose or register a **workspace** folder.
3. Say *"EveryBuddy, 我帮你"* — pick an expert and start a conversation.

### Commands

| Command | Description |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Launch the desktop app |
| `npm run build` | Type-check all workspaces |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run Electron E2E tests |
| `npm run lint` | Biome lint |
| `npm run make` | Package the desktop app |

---

## Documentation

- [Requirements / PRD](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Agent SDK notes (pi-coding-agent)](docs/pi-coding-sdk.md)
- [Collaboration guide](agents.md)

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Desktop | Electron · Electron Forge · Vite |
| UI | React 19 · TypeScript · Zustand · Tailwind CSS 4 |
| Agent runtime | [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi) |
| Multimodal | Vision (VLM) + OpenAI-compatible image generation |
| MCP | `@modelcontextprotocol/sdk` (stdio · Streamable HTTP) |
| Scheduling | `cron-parser` |
| Validation | Zod · TypeBox |
| Quality | Vitest · Playwright · Biome |

## Repository structure

```text
apps/
  desktop/            # Electron + React desktop app
packages/
  ipc-contract/       # Type-safe IPC contract + Zod schemas
  api-gateway/        # Unified request-routing layer (reserved for future IM/Web clients)
docs/                 # PRD, architecture, plans, interactive demos
scripts/
  capture-screenshots.mjs  # Re-generate the README screenshots
```

---

## Roadmap

- **Expert teams** — multi-agent dispatch and workflow orchestration (schema reserved, zero-migration).
- **More connector types** — HTTP API, datasource, filesystem runtime injection.
- **Enterprise controls** — audit, compliance, and RBAC are explicitly deferred (see [requirements](docs/requirements.md)).
- **Web / IM clients** — reuse the same agent runtime via the API gateway.

## License

MIT
