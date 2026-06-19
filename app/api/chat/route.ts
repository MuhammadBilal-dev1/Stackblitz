import { type NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

type ChatMode = "chat" | "review" | "fix" | "optimize"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

interface CodeContext {
  fileName?: string
  language?: string
  codeContent?: string
  cursorPosition?: { line: number; column: number }
  attachments?: Array<{
    name: string
    language: string
    content: string
  }>
}

interface EnhancePromptRequest {
  prompt: string
  context?: {
    fileName?: string
    language?: string
    codeContent?: string
  }
}

const OLLAMA_URL = "http://localhost:11434/api/generate"
const OLLAMA_MODEL = "codellama:7b"

const CHAT_SYSTEM_PROMPT = `You are an expert AI coding assistant. You help developers with:
- Code explanations and debugging
- Best practices and architecture advice
- Writing clean, efficient code
- Troubleshooting errors
- Code reviews and optimizations

Always provide clear, practical answers. When showing code, use proper formatting with language-specific syntax.
Keep responses concise but comprehensive. Use code blocks with language specification when providing code examples.`

const REVIEW_SYSTEM_PROMPT = `You are an expert senior software engineer performing a thorough code review.

Your task is to analyze the provided code and deliver a comprehensive review covering:
- Potential bugs, logic errors, and edge cases
- Security vulnerabilities and unsafe patterns
- Architectural issues, coupling, and design flaws
- Code quality, readability, and maintainability
- Missing error handling, validation, or tests
- Performance concerns and anti-patterns

Structure your review clearly with sections and prioritized findings (critical, major, minor).
Be specific — reference exact lines or patterns. Suggest concrete improvements with code examples where helpful.
Use markdown formatting and fenced code blocks with the correct language tag.`

const FIX_SYSTEM_PROMPT = `You are an expert debugging and repair assistant.

Your task is to identify errors, bugs, and problems in the provided code and deliver corrected solutions.

For each issue found:
1. Explain what is wrong and why it causes problems
2. Show the corrected code with clear before/after or a complete fixed version
3. Note any related issues that should also be addressed

When code is provided, output the fully corrected version in a fenced code block.
Prioritize correctness, then explain your fixes clearly. Use markdown formatting throughout.`

const OPTIMIZE_SYSTEM_PROMPT = `You are an expert performance and efficiency engineer.

Your task is to analyze the provided code and recommend optimizations for:
- Runtime performance and algorithmic complexity
- Memory usage and allocation patterns
- I/O, database, and network efficiency
- Caching opportunities and redundant computations
- Language-specific performance best practices

For each optimization:
1. Explain the current bottleneck or inefficiency
2. Describe the proposed improvement and expected impact
3. Show optimized code in fenced code blocks with the correct language tag

Prioritize high-impact changes. Be specific and practical. Use markdown formatting throughout.`

function getSystemPrompt(mode: ChatMode): string {
  switch (mode) {
    case "review":
      return REVIEW_SYSTEM_PROMPT
    case "fix":
      return FIX_SYSTEM_PROMPT
    case "optimize":
      return OPTIMIZE_SYSTEM_PROMPT
    default:
      return CHAT_SYSTEM_PROMPT
  }
}

function getOllamaOptions(mode: ChatMode): Record<string, unknown> {
  const base = {
    top_p: 0.9,
    repeat_penalty: 1.1,
    context_length: 4096,
  }

  switch (mode) {
    case "review":
      return { ...base, temperature: 0.4, num_predict: 2000 }
    case "fix":
      return { ...base, temperature: 0.2, num_predict: 2000 }
    case "optimize":
      return { ...base, temperature: 0.3, num_predict: 2000 }
    default:
      return { ...base, temperature: 0.7, num_predict: 1000 }
  }
}

function buildContextBlock(context?: CodeContext): string {
  if (!context) return ""

  const sections: string[] = []

  if (context.fileName || context.codeContent) {
    const fileLines: string[] = []
    if (context.fileName) fileLines.push(`File: ${context.fileName}`)
    if (context.language) fileLines.push(`Language: ${context.language}`)
    if (context.cursorPosition) {
      fileLines.push(
        `Cursor position: line ${context.cursorPosition.line}, column ${context.cursorPosition.column}`,
      )
    }
    if (context.codeContent?.trim()) {
      const lang = context.language ?? ""
      fileLines.push(`\n\`\`\`${lang}\n${context.codeContent.trim()}\n\`\`\``)
    }
    sections.push(fileLines.join("\n"))
  }

  if (context.attachments?.length) {
    const attachmentBlocks = context.attachments.map(
      (file) =>
        `### ${file.name} (${file.language})\n\`\`\`${file.language}\n${file.content.trim()}\n\`\`\``,
    )
    sections.push(`Attached files:\n\n${attachmentBlocks.join("\n\n")}`)
  }

  return sections.length > 0 ? `\n\n---\nCode context:\n${sections.join("\n\n")}` : ""
}

function buildUserMessage(message: string, mode: ChatMode, context?: CodeContext): string {
  const contextBlock = buildContextBlock(context)

  if (mode === "review") {
    const request = message.trim() || "Please perform a thorough code review of the provided code."
    return `${request}${contextBlock}`
  }

  if (mode === "fix") {
    const request = message.trim() || "Please identify all errors in the provided code and output the corrected version."
    return `${request}${contextBlock}`
  }

  if (mode === "optimize") {
    const request =
      message.trim() || "Please analyze the provided code and optimize it for better performance and efficiency."
    return `${request}${contextBlock}`
  }

  return `${message}${contextBlock}`
}

function buildPrompt(messages: ChatMessage[], mode: ChatMode = "chat"): string {
  const systemPrompt = getSystemPrompt(mode)
  const fullMessages = [{ role: "system", content: systemPrompt }, ...messages]
  return fullMessages.map((msg) => `${msg.role}: ${msg.content}`).join("\n\n")
}

function parseChatMode(value: unknown): ChatMode {
  if (value === "review" || value === "fix" || value === "optimize") {
    return value
  }
  return "chat"
}

function parseCodeContext(value: unknown): CodeContext | undefined {
  if (!value || typeof value !== "object") return undefined

  const ctx = value as Record<string, unknown>
  const context: CodeContext = {}

  if (typeof ctx.fileName === "string") context.fileName = ctx.fileName
  if (typeof ctx.language === "string") context.language = ctx.language
  if (typeof ctx.codeContent === "string") context.codeContent = ctx.codeContent

  if (
    ctx.cursorPosition &&
    typeof ctx.cursorPosition === "object" &&
    typeof (ctx.cursorPosition as { line?: unknown }).line === "number" &&
    typeof (ctx.cursorPosition as { column?: unknown }).column === "number"
  ) {
    context.cursorPosition = ctx.cursorPosition as { line: number; column: number }
  }

  if (Array.isArray(ctx.attachments)) {
    context.attachments = ctx.attachments
      .filter(
        (item): item is { name: string; language: string; content: string } =>
          !!item &&
          typeof item === "object" &&
          typeof (item as { name?: unknown }).name === "string" &&
          typeof (item as { language?: unknown }).language === "string" &&
          typeof (item as { content?: unknown }).content === "string",
      )
      .map((item) => ({
        name: item.name,
        language: item.language,
        content: item.content,
      }))
  }

  return Object.keys(context).length > 0 ? context : undefined
}

async function fetchOllamaStream(prompt: string, mode: ChatMode = "chat") {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: true,
      options: getOllamaOptions(mode),
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("Error from AI model API:", errorText)
    throw new Error(`AI model API error: ${response.status} - ${errorText}`)
  }

  if (!response.body) {
    throw new Error("No response body from AI model")
  }

  return response.body
}

function createOllamaTextStream(ollamaBody: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = ollamaBody.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""

  return new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.trim()) continue

            try {
              const parsed = JSON.parse(line) as { response?: string; done?: boolean }
              if (parsed.response) {
                controller.enqueue(encoder.encode(parsed.response))
              }
              if (parsed.done) {
                controller.close()
                return
              }
            } catch {
              // Skip malformed NDJSON lines from Ollama
            }
          }
        }

        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer) as { response?: string }
            if (parsed.response) {
              controller.enqueue(encoder.encode(parsed.response))
            }
          } catch {
            // Ignore trailing malformed buffer
          }
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      } finally {
        reader.releaseLock()
      }
    },
    cancel() {
      reader.cancel()
    },
  })
}

async function collectStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }

  return text.trim()
}

async function generateAIResponse(messages: ChatMessage[], mode: ChatMode = "chat"): Promise<string> {
  const prompt = buildPrompt(messages, mode)
  const ollamaBody = await fetchOllamaStream(prompt, mode)
  const textStream = createOllamaTextStream(ollamaBody)
  const response = await collectStreamText(textStream)

  if (!response) {
    throw new Error("No response from AI model")
  }

  return response
}

async function streamAIResponse(
  messages: ChatMessage[],
  mode: ChatMode = "chat",
): Promise<ReadableStream<Uint8Array>> {
  const prompt = buildPrompt(messages, mode)
  const ollamaBody = await fetchOllamaStream(prompt, mode)
  return createOllamaTextStream(ollamaBody)
}

async function enhancePrompt(request: EnhancePromptRequest) {
  const enhancementPrompt = `You are a prompt enhancement assistant. Take the user's basic prompt and enhance it to be more specific, detailed, and effective for a coding AI assistant.

Original prompt: "${request.prompt}"

Context: ${request.context ? JSON.stringify(request.context, null, 2) : "No additional context"}

Enhanced prompt should:
- Be more specific and detailed
- Include relevant technical context
- Ask for specific examples or explanations
- Be clear about expected output format
- Maintain the original intent

Return only the enhanced prompt, nothing else.`

  try {
    const ollamaBody = await fetchOllamaStream(enhancementPrompt, "chat")
    const textStream = createOllamaTextStream(ollamaBody)
    const enhanced = await collectStreamText(textStream)
    return enhanced || request.prompt
  } catch (error) {
    console.error("Prompt enhancement error:", error)
    return request.prompt
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.action === "enhance") {
      const enhancedPrompt = await enhancePrompt(body as EnhancePromptRequest)
      return NextResponse.json({ enhancedPrompt })
    }

    const { message, history, stream = true } = body
    const mode = parseChatMode(body.mode)
    const context = parseCodeContext(body.context)

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required and must be a string" }, { status: 400 })
    }

    const validHistory = Array.isArray(history)
      ? history.filter(
          (msg: unknown) =>
            msg &&
            typeof msg === "object" &&
            typeof (msg as ChatMessage).role === "string" &&
            typeof (msg as ChatMessage).content === "string" &&
            ["user", "assistant"].includes((msg as ChatMessage).role),
        )
      : []

    const recentHistory = validHistory.slice(-10)
    const userMessage = buildUserMessage(message, mode, context)
    const messages: ChatMessage[] = [...recentHistory, { role: "user", content: userMessage }]

    if (stream) {
      const textStream = await streamAIResponse(messages, mode)

      return new Response(textStream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Content-Type-Options": "nosniff",
          "X-Chat-Mode": mode,
        },
      })
    }

    const aiResponse = await generateAIResponse(messages, mode)

    return NextResponse.json({
      response: aiResponse,
      mode,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Error in AI chat route:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
    return NextResponse.json(
      {
        error: "Failed to generate AI response",
        details: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    status: "AI Chat API is running",
    timestamp: new Date().toISOString(),
    info: "Use POST method to send chat messages or enhance prompts",
    supportedModes: ["chat", "review", "fix", "optimize"],
  })
}
