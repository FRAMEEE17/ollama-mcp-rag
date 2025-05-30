import { Readable } from 'stream'
import { formatDocumentsAsString } from "langchain/util/document"
import { PromptTemplate } from "@langchain/core/prompts"
import { RunnableSequence } from "@langchain/core/runnables"
// import { CohereRerank } from "@langchain/cohere"
import { CohereRerank } from "@/server/rerank/cohere"
import { setEventStreamResponse } from '@/server/utils'
import { BaseRetriever } from "@langchain/core/retrievers"
import prisma from "@/server/utils/prisma"
import { createChatModel, createEmbeddings } from '@/server/utils/models'
import { createRetriever } from '@/server/retriever'
import { AIMessage, AIMessageChunk, AIMessageFields, BaseMessage, BaseMessageChunk, BaseMessageLike, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { resolveCoreference } from '~/server/coref'
import { concat } from "@langchain/core/utils/stream"
import { MODEL_FAMILIES } from '~/config'
import { McpService } from '@/server/utils/mcp'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ChatOllama } from '@langchain/ollama'
import { StructuredToolInterface, tool } from '@langchain/core/tools'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'

// Interface definitions for request/response structure
interface MessageContent {
  type: string
  text?: string
  image_url?: { url: string }
}

interface RequestBody {
  knowledgebaseId: number        // ID of knowledge base to query (optional)
  model: string                  // Model name (e.g., 'gpt-4', 'claude-3')
  family: string                 // Model family (e.g., 'openai', 'anthropic')
  messages: {                    // Chat history
    role: 'user' | 'assistant'
    content: string | MessageContent[]  // Text or multimodal content
    toolCallId?: string          // For tool response messages
    toolResult: boolean          // Whether this is a tool result
  }[]
  stream: any                    // Whether to stream response
}

// System prompt template for RAG (Retrieval Augmented Generation)
const SYSTEM_TEMPLATE = `Answer the user's question based on the context below.
Present your answer in a structured Markdown format.

If the context doesn't contain any relevant information to the question, don't make something up and just say "I don't know":

<context>
{context}
</context>

<chat_history>
{chatHistory}
</chat_history>

<question>
{question}
</question>

Answer:
`

// Helper function: Convert messages array to string format for prompt
const serializeMessages = (messages: RequestBody['messages']): string =>
  messages.map((message) => {
    if (Array.isArray(message.content)) {
      // For multimodal messages (text + images), extract only text parts
      const textParts = message.content
        .filter((part): part is MessageContent & { text: string } =>
          part.type === 'text' && typeof part.text === 'string'
        )
        .map(part => part.text)
        .join(' ')
      return `${message.role}: ${textParts}`
    }
    // For simple text messages
    return `${message.role}: ${message.content}`
  }).join("\n")

// Helper function: Transform messages to LangChain format
const transformMessages = (messages: RequestBody['messages']): BaseMessageLike[] =>
  messages.map((message) => {
    if (Array.isArray(message.content)) {
      // Handle multimodal content (text + images)
      return [message.role, message.content]
    }
    // Handle simple text content
    return [message.role, message.content]
  })

// Helper function: Normalize messages to specific LangChain message types
const normalizeMessages = (messages: RequestBody['messages']): BaseMessage[] => {
  const normalizedMessages = []
  for (const message of messages) {
    if (message.toolResult) {
      // Tool execution results
      normalizedMessages.push(new ToolMessage(message.content as string, message.toolCallId!))
    } else if (message.role === "user") {
      // User messages (text or multimodal)
      if (Array.isArray(message.content)) {
        normalizedMessages.push(new HumanMessage({ content: message.content }))
      } else {
        normalizedMessages.push(new HumanMessage(message.content))
      }
    } else if (message.role === "assistant") {
      // Assistant messages
      normalizedMessages.push(new AIMessage(message.content as string))
    }
  }

  return normalizedMessages
}

// Main API handler
export default defineEventHandler(async (event) => {
  // Parse request body
  const { knowledgebaseId, model, family, messages, stream } = await readBody<RequestBody>(event)

  // KNOWLEDGE BASE CHAT PATH
  // If knowledgebaseId is provided, use RAG (Retrieval Augmented Generation)
  if (knowledgebaseId) {
    console.log("Chat with knowledge base with id: ", knowledgebaseId)
    
    // Fetch knowledge base from database
    const knowledgebase = await prisma.knowledgeBase.findUnique({
      where: {
        id: knowledgebaseId,
      },
    })
    console.log(`Knowledge base ${knowledgebase?.name} with embedding "${knowledgebase?.embedding}"`)
    
    if (!knowledgebase) {
      setResponseStatus(event, 404, `Knowledge base with id ${knowledgebaseId} not found`)
      return
    }

    // Create embeddings model for vector search
    const embeddings = createEmbeddings(knowledgebase.embedding!, event)
    
    // Create retriever for finding relevant documents
    const retriever = await createRetriever(embeddings, `collection_${knowledgebase.id}`)

    // Create chat model
    const chat = createChatModel(model, family, event)
    
    // Extract user query from the last message
    const query = (() => {
      const lastMessage = messages[messages.length - 1].content
      if (Array.isArray(lastMessage)) {
        // For multimodal content, extract text parts
        return lastMessage
          .filter((part): part is MessageContent & { text: string } =>
            part.type === 'text' && typeof part.text === 'string'
          )
          .map(part => part.text)
          .join(' ')
      }
      return lastMessage
    })()
    console.log("User query: ", query)

    //TODO: Coreference resolution (currently commented out)
    // const reformulatedResult = await resolveCoreference(query, normalizeMessages(messages), chat)
    const reformulatedQuery = query
    console.log("Reformulated query: ", reformulatedQuery)

    // Retrieve relevant documents from vector store
    const relevant_docs = await retriever.invoke(reformulatedQuery)
    console.log("Relevant documents: ", relevant_docs)

    let rerankedDocuments = relevant_docs

    // OPTIONAL: Cohere reranking for better document relevance
    if ((process.env.COHERE_API_KEY || process.env.COHERE_BASE_URL) && process.env.COHERE_MODEL) {
      const options = {
        apiKey: process.env.COHERE_API_KEY,
        baseUrl: process.env.COHERE_BASE_URL,
        model: process.env.COHERE_MODEL,
        topN: 4
      }
      console.log("Cohere Rerank Options: ", options)
      const cohereRerank = new CohereRerank(options)
      rerankedDocuments = await cohereRerank.compressDocuments(relevant_docs, reformulatedQuery)
      console.log("Cohere reranked documents: ", rerankedDocuments)
    }

    // Create RAG chain: Context + Chat History + Question → LLM
    const chain = RunnableSequence.from([
      {
        question: (input: { question: string; chatHistory?: string }) =>
          input.question,
        chatHistory: (input: { question: string; chatHistory?: string }) =>
          input.chatHistory ?? "",
        context: async () => {
          // Format retrieved documents as context string
          return formatDocumentsAsString(rerankedDocuments)
        },
      },
      PromptTemplate.fromTemplate(SYSTEM_TEMPLATE),
      chat
    ])

    // NON-STREAMING RESPONSE
    if (!stream) {
      const response = await chain.invoke({
        question: query,
        chatHistory: serializeMessages(messages),
      })

      return {
        message: {
          role: 'assistant',
          content: typeof response?.content === 'string' ? response.content : response?.content.toString(),
          relevant_docs  // Include relevant documents in response
        }
      }
    }

    // STREAMING RESPONSE
    setEventStreamResponse(event)
    const response = await chain.stream({
      question: query,
      chatHistory: serializeMessages(messages),
    })

    // Create readable stream for Server-Sent Events
    const readableStream = Readable.from((async function* () {
      // Stream each chunk of the response
      for await (const chunk of response) {
        if (chunk?.content !== undefined) {
          const message = {
            message: {
              role: 'assistant',
              content: chunk?.content
            }
          }
          yield `${JSON.stringify(message)} \n\n`
        }
      }

      // Send relevant documents at the end
      const docsChunk = {
        type: "relevant_documents",
        relevant_documents: rerankedDocuments
      }
      yield `${JSON.stringify(docsChunk)} \n\n`
    })())
    return sendStream(event, readableStream)
    
  } else {
    // REGULAR CHAT PATH (without knowledge base)
    
    // Create chat model
    let llm = createChatModel(model, family, event)

    // MCP (Model Context Protocol) - Tool Calling Setup
    const mcpService = new McpService()
    const normalizedTools = await mcpService.listTools()
    
    // Create tools map for quick lookup
    const toolsMap = normalizedTools.reduce((acc: Record<string, StructuredToolInterface>, tool) => {
      acc[tool.name] = tool
      return acc
    }, {})

    // Bind tools to LLM if supported
    if (llm?.bindTools) {
      console.log("Binding tools to LLM")
      llm = llm.bindTools(normalizedTools) as BaseChatModel
    }

    // NON-STREAMING RESPONSE
    if (!stream) {
      const response = await llm.invoke(transformMessages(messages))
      console.log(response)
      return {
        message: {
          role: 'assistant',
          content: typeof response?.content === 'string' ? response.content : response?.content.toString()
        }
      }
    }

    // STREAMING RESPONSE WITH TOOL CALLING
    console.log("Streaming response")
    const transformedMessages = messages.map((message: RequestBody['messages'][number]) => {
      return [message.role, message.content]
    }) as BaseMessageLike[]
    
    const response = await llm?.stream(transformedMessages)
    console.log(response)

    const readableStream = Readable.from((async function* () {
      let gathered = undefined

      // Stream response chunks
      for await (const chunk of response) {
        // Accumulate chunks for potential tool calling
        gathered = gathered !== undefined ? concat(gathered, chunk) : chunk

        let content = chunk?.content
        // Handle different content formats
        if (Array.isArray(content)) {
          content = content
            .filter((item): item is { type: string; text: string } => 
              (item.type === 'text_delta' || item.type === 'text') && 'text' in item
            )
            .map(item => item.text)
            .join('')
        }

        // Send content chunk to client
        const message = {
          message: {
            role: 'assistant',
            content: content
          }
        }
        yield `${JSON.stringify(message)} \n\n`
      }

      // TOOL CALLING EXECUTION
      const toolMessages = [] as ToolMessage[]
      console.log("Gathered response: ", gathered)
      
      // Process each tool call made by the LLM
      for (const toolCall of gathered?.tool_calls ?? []) {
        console.log("Tool call: ", toolCall)
        const selectedTool = toolsMap[toolCall.name]

        if (selectedTool) {
          // Execute the tool
          const result = await selectedTool.invoke(toolCall)
          console.log("Tool result: ", result)

          // Send tool result to client
          const message = {
            message: {
              role: "user",
              type: "tool_result",
              tool_use_id: result.tool_call_id,
              content: result.content
            }
          }

          toolMessages.push(new ToolMessage(result.content, result.tool_call_id))
          yield `${JSON.stringify(message)} \n\n`
        }
      }

      // Clean up MCP service
      await mcpService.close()

      // FINAL RESPONSE WITH TOOL RESULTS
      if (toolMessages.length) {
        console.log("Inferencing with tool results")
        // Add tool call and results to conversation history
        transformedMessages.push(new AIMessage(gathered as AIMessageFields))
        transformedMessages.push(...toolMessages)
        
        // Get final response from LLM with tool results
        const finalResponse = await llm.stream(transformedMessages as BaseMessageLike[])

        // Stream the final response
        for await (const chunk of finalResponse) {
          let content = chunk?.content
          // Handle different content formats
          if (Array.isArray(content)) {
            content = content
              .filter((item): item is MessageContent & { type: 'text_delta'; text: string } | { type: 'text'; text: string } =>
                item.type === 'text_delta' && 'text' in item || item.type === 'text' && 'text' in item
              )
              .map(item => item.text)
              .join('')
          }

          const message = {
            message: {
              role: 'assistant',
              content: content
            }
          }
          yield `${JSON.stringify(message)} \n\n`
        }
      }
    })())

    return sendStream(event, readableStream)
  }
})