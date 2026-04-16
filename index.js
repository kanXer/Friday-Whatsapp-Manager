require('dotenv').config()

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')

const qrcode = require('qrcode-terminal')
const Boom = require('@hapi/boom')
const chokidar = require('chokidar')
const fs = require('fs')
const path = require('path')

const LLMEngine = require('./core/llm')

const BRAIN_PATH = process.env.BRAIN_PATH || "brain"

const llm = new LLMEngine({})
const messageHistory = new Map()

// Silent logger - simple object
const log = {
    trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, 
    error: console.error, fatal: () => {}, child: () => log
}

async function startBot() {
    console.clear()
    console.log('🤖 FRIDAY Bot Ready!\n')

    // Brain files
    const brain = loadBrain()

    // Auth
    const { state, saveCreds } = await useMultiFileAuthState('session')

    // Version
    const { version } = await fetchLatestBaileysVersion()
    console.log(`📱 WA v${version[0]}.${version[1]}`)

    // Socket
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: log,
        browser: ["Ubuntu", "Chrome", "126.0.0"],
        syncFullHistory: true
    })

    // Credentials save
    sock.ev.on('creds.update', saveCreds)

    // 4. Connection & QR Handler
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log("\n📱 Scan this QR with WhatsApp:\n")
            qrcode.generate(qr, { small: true })
            console.log("\n" + "─".repeat(40) + "\n")
        }

        if (connection === 'open') {
            console.log("✅ WhatsApp Connected Successfully!\n")
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode
            console.log("❌ Connection closed. Reason:", reason)

            if (reason === DisconnectReason.loggedOut) {
                console.log("🚫 Session expired. Delete 'session' folder and scan again.")
            } else {
                console.log("🔄 Reconnecting...")
                startBot()
            }
        }
    })

    // Suppress Baileys init errors
    sock.ev.on('error', (err) => {
        if (err.message?.includes('bad-request') || err.message?.includes('init queries')) {
            console.log("⚠️ Minor connection issue, continuing...")
            return
        }
        console.error("❌ Socket Error:", err.message)
    })

    // 5. Message Handler
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue

            const chat = msg.key.remoteJid
            const isGroup = chat.endsWith('@g.us')
            const sender = msg.key.participant || chat
            const pushName = msg.pushName || 'User'
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text

            if (!text) continue
            if (isGroup) continue // Skip groups

            console.log(`\n📩 ${pushName}: ${text}`)

            // Get chat history for context
            if (!messageHistory.has(chat)) {
                messageHistory.set(chat, [])
            }
            const history = messageHistory.get(chat)
            history.push({ role: 'user', content: text })
            if (history.length > 5) history.shift()

            try {
                // Keep typing indicator while processing
                await sock.sendPresenceUpdate('composing', chat)
                const typingInterval = setInterval(async () => {
                    await sock.sendPresenceUpdate('composing', chat)
                }, 3000)

                // Check brain commands first
                let reply = checkBrain(text, brain, chat)

                if (!reply) {
                    // Build prompt with brain context + history
                    const personality = brain.personality || ''
                    const behavior = brain.behavior || ''
                    const memory = brain.memory || ''
                    
                    const historyText = history.map(m => `${m.role === 'user' ? 'User' : 'FRIDAY'}: ${m.content}`).join('\n')
                    
                    const prompt = `${personality}\n${behavior}\n${memory}\n\nRecent conversation:\n${historyText}\n\nYou are FRIDAY. Reply naturally like a human on WhatsApp.\nUser: ${text}\nFRIDAY:`
                    
                    // Call LLM using core/llm.js (reads env automatically)
                    try {
                        reply = await llm.generateReply(prompt, chat)
                    } catch (apiErr) {
                        console.log("❌ LLM error:", apiErr.message)
                        reply = `${text}. Tell me more!`
                    }
                }

                // Stop typing
                clearInterval(typingInterval)
                await sock.sendPresenceUpdate('paused', chat)

                console.log(`🤖 Reply: ${reply}`)

                // Send reply
                await sock.sendMessage(chat, { text: reply.toString().trim() })
                
                // Add bot response to history
                history.push({ role: 'assistant', content: reply })

            } catch (err) {
                console.error("❌ Error:", err.message)
                try {
                    await sock.sendMessage(chat, { text: "Sorry, error occurred." })
                } catch (e) {}
            }
        }
    })

    // Watch brain files
    watchBrain(brain)

    console.log("✅ Bot ready! Press Ctrl+C to stop.\n")
}

function loadBrain() {
    const brain = {}
    const files = ['personality', 'behavior', 'rules', 'memory']
    
    for (const file of files) {
        const p = path.join(BRAIN_PATH, file + '.md')
        if (fs.existsSync(p)) {
            brain[file] = fs.readFileSync(p, 'utf-8')
        }
    }
    return brain
}

function checkBrain(text, brain, chat) {
    const lower = text.toLowerCase().trim()
    
    // Memory commands
    if (lower.startsWith('/memory add ')) {
        const info = text.slice(12).trim()
        const memFile = path.join(BRAIN_PATH, 'memory.md')
        const current = fs.existsSync(memFile) ? fs.readFileSync(memFile, 'utf-8') : '# Memory\n\nUser memories:\n'
        fs.writeFileSync(memFile, current + `- ${info}\n`)
        Object.assign(brain, loadBrain())
        return "✅ Memory saved!"
    }
    
    if (lower === '/memory clear') {
        fs.writeFileSync(path.join(BRAIN_PATH, 'memory.md'), '# Memory\n\nUser memories:\n')
        Object.assign(brain, loadBrain())
        return "🗑️ Memory cleared!"
    }
    
    // Commands
    if (lower === '/reload') {
        Object.assign(brain, loadBrain())
        return "🔄 Brain reloaded!"
    }
    if (lower === '/help') {
        return "Commands:\n/reload - Reload brain\n/memory add <info> - Save info\n/memory clear - Clear memory\n/ping - Pong"
    }
    if (lower === '/ping') {
        return "pong 🏓"
    }

    return null
}

function getLocalReply(text) {
    const lower = text.toLowerCase().trim()
    
    const responses = {
        'hi': 'Hello! 👋',
        'hello': 'Hi there! How can I help?',
        'hey': 'Hey! Whats up?',
        'hy': 'Hello! 👋',
        'how are you': "I'm fine! Thanks for asking 😊",
        'what is your name': "I'm FRIDAY - your WhatsApp assistant!",
        'who are you': "I'm FRIDAY, an AI bot built with Baileys!",
        'thanks': 'Welcome! 😊',
        'thank you': 'You are welcome! 😊',
        'bye': 'Goodbye! 👋',
        'ok': 'Great! 👍',
        'lol': 'Haha! 😂',
        'haha': 'Haha! 😂',
    }
    
    for (const [key, value] of Object.entries(responses)) {
        if (lower.includes(key)) {
            return value
        }
    }
    
    return "I didn't quite catch that. Try /help for commands!"
}

function watchBrain(brain) {
    const files = [
        path.join(BRAIN_PATH, 'personality.md'),
        path.join(BRAIN_PATH, 'behavior.md'),
        path.join(BRAIN_PATH, 'rules.md'),
        path.join(BRAIN_PATH, 'memory.md')
    ]
    
    chokidar.watch(files, { persistent: true, ignoreInitial: true })
        .on('change', () => {
            console.log("📝 Brain file changed, reloading...")
            Object.assign(brain, loadBrain())
        })
}

// Handle shutdown
process.on('SIGINT', () => {
    console.log("\n👋 Bot stopped.")
    process.exit(0)
})

// Start bot
startBot().catch(err => {
    console.error("❌ Critical Error:", err.message)
    process.exit(1)
})