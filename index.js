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
const HISTORY_FILE = 'chat_history.json'
const MAX_HISTORY_PER_CHAT = 50

const llm = new LLMEngine({})

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf-8')
            const parsed = JSON.parse(data)
            const map = new Map()
            let totalMsgs = 0
            for (const [key, value] of Object.entries(parsed)) {
                map.set(key, value)
                totalMsgs += value.length
            }
            console.log(`📜 Loaded history for ${map.size} chats (${totalMsgs} total messages)`)
            return map
        }
    } catch (err) {
        console.log("⚠️ Could not load history, starting fresh")
    }
    return new Map()
}

function saveHistory(history) {
    try {
        const obj = Object.fromEntries(history)
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(obj, null, 2), 'utf-8')
    } catch (err) {
        console.error("❌ Failed to save history:", err.message)
    }
}

const messageHistory = loadHistory()

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
            const reason = Boom.boomify(lastDisconnect?.error)?.output?.statusCode
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

            // Get mentions - check if bot is @mentioned
            const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
            const botJid = sock.user?.id?.replace(':131@', '@s.whatsapp.net') || ''
            const isBotMentioned = mentions.includes(botJid) || mentions.some(m => m.includes(botJid.split('@')[1]))

            // In groups: only respond if @mentioned
            // In DM: always respond
            if (isGroup && !isBotMentioned) continue

            // Get chat history for context
            if (!messageHistory.has(chat)) {
                messageHistory.set(chat, [])
            }
            const history = messageHistory.get(chat)
            
            console.log(`\n📩 ${pushName}: ${text}`)
            console.log(`📜 Using ${history.length} messages from history`)
            
            history.push({ role: 'user', content: text, timestamp: Date.now() })
            if (history.length > MAX_HISTORY_PER_CHAT) history.shift()
            saveHistory(messageHistory)

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
                    
                    const recentHistory = history.slice(-12)
                    const historyText = recentHistory.map(m => {
                        const time = new Date(m.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                        return `[${time}] ${m.role === 'user' ? 'User' : 'FRIDAY'}: ${m.content}`
                    }).join('\n')
                    
                    const prompt = `${personality}\n${behavior}\n${memory}\n\nRecent conversation (remember this context):\n${historyText}\n\nYou are FRIDAY. Remember the conversation above. Reply naturally like a human on WhatsApp based on the context.\n\nIMPORTANT: If user shares personal info (name, age, preferences, facts about themselves, hobbies, etc.), end your response with "[MEMORY: <what to remember>]" so I can save it. Example: "Nice to meet you!" [MEMORY: user's name is John]\n\nUser: ${text}\nFRIDAY:`
                    
                    // Call LLM using core/llm.js (reads env automatically)
                    try {
                        reply = await llm.generateReply(prompt, chat)
                        
                        // Check if LLM wants to save something to memory
                        const memoryMatch = reply.match(/\[MEMORY:\s*(.+?)\]/i)
                        if (memoryMatch) {
                            const memoryInfo = memoryMatch[1].trim()
                            const memFile = path.join(BRAIN_PATH, 'memory.md')
                            const current = fs.existsSync(memFile) ? fs.readFileSync(memFile, 'utf-8') : '# Memory\n\nUser memories:\n'
                            if (!current.includes(memoryInfo)) {
                                fs.writeFileSync(memFile, current + `- ${memoryInfo}\n`)
                                console.log(`📝 LLM saved to memory: ${memoryInfo}`)
                            }
                            reply = reply.replace(/\[MEMORY:\s*.+?\]/gi, '').trim()
                        }
                    } catch (apiErr) {
                        console.log("❌ LLM error:", apiErr.message)
                        reply = "Sorry, something went wrong. Try again!"
                    }
                }

                // Stop typing
                clearInterval(typingInterval)
                await sock.sendPresenceUpdate('paused', chat)

                console.log(`🤖 Reply: ${reply}`)

                // Send reply
                await sock.sendMessage(chat, { text: reply.toString().trim() })
                
                // Add bot response to history
                history.push({ role: 'assistant', content: reply, timestamp: Date.now() })
                saveHistory(messageHistory)

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
        return "Commands:\n/reload - Reload brain\n/memory add <info> - Save info\n/memory clear - Clear memory\n/clearhistory - Clear chat history\n/ping - Pong"
    }
    if (lower === '/ping') {
        return "pong 🏓"
    }
    
    if (lower === '/clearhistory') {
        messageHistory.set(chat, [])
        saveHistory(messageHistory)
        return "🗑️ Chat history cleared for this conversation!"
    }
    
    // Auto-detect memory commands
    const memoryPatterns = [
        'remember that', 'remember this', 'remember,',
        'save this', 'save it', 'save that', 'keep this in mind',
        'isko yaad rakh', 'yaad rakh', 'yaad rakho',
        'bhool mat', 'mat bhoolna', `don't forget`,
        'mera naam hai', 'i am', 'i\'m', 'my name is',
        'meri age', 'meri umar', 'my age is',
        'mai', 'मैं', 'मेरा', 'meri', 'mera'
    ]
    
    const lowerText = lower.trim()
    const shouldSaveToMemory = memoryPatterns.some(pattern => lowerText.includes(pattern))
    
    if (shouldSaveToMemory) {
        // Extract the key info to save
        let infoToSave = text
        
        // Clean up the command words from the text
        for (const pattern of memoryPatterns) {
            infoToSave = infoToSave.replace(new RegExp(pattern, 'gi'), '')
        }
        infoToSave = infoToSave.replace(/[,.\/!@#$%^&*]/g, '').trim()
        
        if (infoToSave.length > 3) {
            const memFile = path.join(BRAIN_PATH, 'memory.md')
            const current = fs.existsSync(memFile) ? fs.readFileSync(memFile, 'utf-8') : '# Memory\n\nUser memories:\n'
            
            // Check for duplicates
            if (!current.includes(infoToSave)) {
                fs.writeFileSync(memFile, current + `- ${infoToSave}\n`)
                Object.assign(brain, loadBrain())
                saveHistory(messageHistory)
                console.log(`📝 Auto-saved to memory: ${infoToSave}`)
            }
        }
    }

    return null
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