# FRIDAY - WhatsApp AI Bot

LLM-powered WhatsApp bot using Ollama (or Gemini/OpenAI as fallback).

## Prerequisites

- Node.js 18+
- Ollama installed and running (for local LLM)
- WhatsApp account

## Installation

```bash
# Install dependencies
npm install

# Make sure Ollama is running
# ollama serve
```

## Environment Configuration

Create or edit `.env` file:

```env
# LLM Mode: ollama, gemini, openai
LLM_MODE=ollama

# Ollama (Primary)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=sorc/qwen3.5-instruct:4b
BRAIN_PATH=brain

# Gemini (Fallback - optional)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash

# OpenAI (Optional Fallback)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini

# Bot Config
BOT_NAME=FRIDAY
SESSION_PATH=session
LOG_LEVEL=info
```

### Key Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_MODE` | Which LLM to use | `ollama` |
| `OLLAMA_URL` | Ollama server URL | `http://localhost:11434` |
| `OLLAMA_MODEL` | Model name to use | `sorc/qwen3.5-instruct:4b` |
| `GEMINI_API_KEY` | Google Gemini API key | (empty) |
| `OPENAI_API_KEY` | OpenAI API key | (empty) |

## Running the Bot

```bash
npm start
# or
node index.js
```

### First Run
1. Bot will show a QR code in terminal
2. Scan with WhatsApp (Settings > Linked Devices)
3. Bot connects and ready to use

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/ping` | Test bot is responding |
| `/reload` | Reload brain files |
| `/memory add <info>` | Save info to memory |
| `/memory clear` | Clear saved memories |

### Brain Files

Edit files in `brain/` folder to customize bot behavior:

- `personality.md` - Bot personality traits
- `behavior.md` - Response behavior rules
- `rules.md` - Custom rules
- `memory.md` - Saved user info

Brain files auto-reload when modified.

### Typing Indicator

Bot shows "typing" while processing your message.

## Troubleshooting

### "bad-request" Error
This is a minor connection warning. Bot continues working normally.

### Ollama Not Running
```bash
# Start Ollama
ollama serve

# Or pull a model
ollama pull qwen2.5
```

### Session Expired
Delete `session/` folder and restart bot to re-scan QR.

## Project Structure

```
├── index.js          # Main bot file
├── core/
│   ├── llm.js        # LLM engine (Ollama/Gemini/OpenAI)
│   ├── brainLoader.js # Brain file manager
│   └── memory.js     # Memory handler
├── brain/
│   ├── personality.md
│   ├── behavior.md
│   ├── rules.md
│   └── memory.md
├── session/          # WhatsApp auth session
└── .env             # Configuration
```

## License

MIT