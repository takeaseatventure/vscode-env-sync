# 🔄 Env Sync

### Auto-generate `.env.example` from your codebase — across 7 languages.


**Env Sync** scans your entire codebase and auto-generates a complete `.env.example` file — so new developers know exactly what environment variables your project needs. Stop shipping broken deploys because of missing config.

> ⚡ **Zero runtime dependencies. Privacy-first — all scanning happens locally.**

---

## ✨ Features

- ✅ **Generate `.env.example`** — Scans your workspace and outputs every environment variable your code references, grouped, sorted, and annotated with file locations
- ✅ **Validate `.env` against `.env.example`** — Instantly see which variables are missing or extra
- ✅ **Diff Code vs. Documentation** — Compare what your code actually uses against what's documented — catch drift before it breaks a deploy
- ✅ **Scan Current File** — Quickly check the active file for all environment variable references
- ✅ **7-Language Support** — JavaScript, TypeScript, Python, Java, Ruby, Rust, Go, and Shell

---

## 📸 Screenshots

![Generated .env.example](images/generate.png)

![Validate .env](images/validate.png)

![Diff View](images/diff.png)

---

## 📥 Installation

1. Open **VS Code**
2. Go to the **Extensions** view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **Env Sync**
4. Click **Install**

Or install from the command line:

```bash
code --install-extension devforge.env-sync
```

---

## 🚀 Usage

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

| Command | Shortcut | Description |
|---------|----------|-------------|
| **Env Sync: Generate .env.example** | `Ctrl+Alt+G` / `Cmd+Alt+G` | Scan workspace and generate/sync the file |
| **Env Sync: Validate .env against .env.example** | `Ctrl+Alt+V` / `Cmd+Alt+V` | Check for missing/extra variables |
| **Env Sync: Show Missing/Extra Variables** | `Ctrl+Alt+E` / `Cmd+Alt+E` | Compare code usage against documented vars |
| **Env Sync: Scan Current File** | `Ctrl+Alt+C` / `Cmd+Alt+C` | List env vars in the active editor |

---

## 🌐 Supported Languages

| Language | Patterns Detected |
|----------|-------------------|
| **JavaScript / TypeScript** | `process.env.NAME`, `process.env['NAME']` |
| **Python** | `os.environ.get('NAME')`, `os.getenv('NAME')`, `os.environ['NAME']` |
| **Java** | `System.getenv("NAME")` |
| **Ruby** | `ENV['NAME']` |
| **Rust** | `env::var("NAME")` |
| **Go** | `os.LookupEnv("NAME")` |
| **Shell** | *(pattern matching on uppercase variables)* |

---

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `envsync.outputFile` | `.env.example` | Output file for generated environment variable documentation |
| `envsync.includeComments` | `true` | Include file-location comments next to each variable |
| `envsync.excludeDirs` | `["node_modules", ".git", "vendor", "dist", ...]` | Directories to exclude from scanning |
| `envsync.scanExtensions` | `[".js", ".ts", ".py", ".go", ".rs", ...]` | File extensions to scan |

---

## 📋 Why Env Sync?

- 👋 **Onboarding** — New team members get a complete `.env.example`. No more *"what env vars do I need?"* Slack messages.
- 🚀 **Deploy safety** — Never deploy without a required environment variable again.
- 🌐 **Multi-language** — Works across your polyglot codebase — Node, Python, Go, Rust, and more.
- 🔒 **Privacy-first** — All scanning happens locally in your editor. No data leaves your machine.

---

## 💎 Pro Features

Upgrade to **Pro** for advanced environment management:

- 🏷️ **Variable descriptions** — Auto-document each variable with inferred types, defaults, and descriptions
- 🔗 **CI/CD integration** — Export validation results for pipelines and pre-commit hooks
- 📊 **Variable usage heatmap** — Visual map showing where each variable is used across your codebase
- 🔄 **Auto-sync on save** — Automatically regenerate `.env.example` whenever you save a file
- 📤 **Multi-format export** — Export to JSON, YAML, or TOML for infrastructure-as-code tools

**Upgrade to Pro for auto-documentation, CI/CD integration, usage heatmaps, and multi-format export — $5/month (or $15/month for teams). Visit [https://devforge.dev](https://devforge.dev) to get your license key.**

---

## 📄 License

MIT — free for personal and commercial use.

---

**Built by [DevForge](https://devforge.dev)** — developer tools that solve real daily pain.
