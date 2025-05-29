import { z } from 'zod'

// ===== ArXiv Tool Schemas =====

export const ArxivQueryInputSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  max_results: z.number().min(1).max(20).default(5),
  sort_by: z.enum(['relevance', 'lastUpdated', 'submitted']).default('relevance'),
  category: z.string().optional().default('')
})

export const ArxivPaperSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  authors: z.array(z.object({ name: z.string() })),
  published: z.string(),
  updated: z.string(),
  categories: z.array(z.string()),
  pdf_url: z.string(),
  abstract_url: z.string()
})

export const ArxivSearchResultSchema = z.object({
  papers: z.array(ArxivPaperSchema),
  total_results: z.number(),
  query: z.string(),
  execution_time: z.number()
})

// ===== Web Scraper Tool Schemas =====

export const WebScraperInputSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  extract_type: z.enum(['content', 'metadata', 'links', 'all']).default('content'),
  wait_for_selector: z.string().optional(),
  timeout: z.number().min(1000).max(60000).default(30000),
  user_agent: z.string().optional(),
  include_images: z.boolean().default(false)
})

export const ScrapedContentSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  content: z.string(),
  metadata: z.object({
    description: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    author: z.string().optional(),
    published_date: z.string().optional()
  }).optional(),
  links: z.array(z.object({
    text: z.string(),
    url: z.string(),
    type: z.enum(['internal', 'external'])
  })).optional(),
  images: z.array(z.object({
    src: z.string(),
    alt: z.string().optional(),
    title: z.string().optional()
  })).optional(),
  extraction_time: z.number(),
  success: z.boolean()
})

// ===== Hybrid Search Tool Schemas =====

export const HybridSearchInputSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  collections: z.array(z.string()).default(['academic-papers']),
  max_results: z.number().min(1).max(50).default(10),
  search_type: z.enum(['semantic', 'keyword', 'hybrid']).default('hybrid'),
  rerank: z.boolean().default(true),
  include_metadata: z.boolean().default(true),
  similarity_threshold: z.number().min(0).max(1).default(0.7)
})

export const SearchResultSchema = z.object({
  id: z.string(),
  content: z.string(),
  metadata: z.record(z.any()).optional(),
  score: z.number(),
  collection: z.string(),
  source: z.string().optional()
})

export const HybridSearchResultSchema = z.object({
  results: z.array(SearchResultSchema),
  total_results: z.number(),
  query: z.string(),
  collections_searched: z.array(z.string()),
  search_type: z.string(),
  execution_time: z.number(),
  reranked: z.boolean()
})

// ===== Memory Manager Tool Schemas =====

export const MemoryStoreInputSchema = z.object({
  key: z.string().min(1, 'Memory key is required'),
  value: z.any(),
  namespace: z.string().default('research-session'),
  ttl: z.number().optional(), // Time to live in seconds
  metadata: z.record(z.any()).optional()
})

export const MemoryRetrieveInputSchema = z.object({
  key: z.string().min(1, 'Memory key is required'),
  namespace: z.string().default('research-session'),
  default_value: z.any().optional()
})

export const MemorySearchInputSchema = z.object({
  pattern: z.string().min(1, 'Search pattern is required'),
  namespace: z.string().default('research-session'),
  limit: z.number().min(1).max(100).default(10)
})

export const MemoryItemSchema = z.object({
  key: z.string(),
  value: z.any(),
  namespace: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  ttl: z.number().optional(),
  metadata: z.record(z.any()).optional()
})

// ===== Brave Search Tool Schemas (Enhanced) =====

export const BraveSearchInputSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  count: z.number().min(1).max(20).default(10),
  search_type: z.enum(['web', 'news', 'images']).default('web'),
  country: z.string().length(2).optional(), // ISO country code
  safe_search: z.enum(['strict', 'moderate', 'off']).default('moderate'),
  freshness: z.enum(['day', 'week', 'month', 'year']).optional(),
  include_domains: z.array(z.string()).optional(),
  exclude_domains: z.array(z.string()).optional()
})

export const BraveSearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
  published_date: z.string().optional(),
  thumbnail: z.string().optional(),
  domain: z.string(),
  language: z.string().optional()
})

export const BraveSearchResponseSchema = z.object({
  results: z.array(BraveSearchResultSchema),
  total_results: z.number(),
  query: z.string(),
  search_type: z.string(),
  execution_time: z.number()
})

// ===== Common Error Schema =====

export const ToolErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.record(z.any()).optional(),
  timestamp: z.string()
})

// ===== Type Exports =====

export type ArxivQueryInput = z.infer<typeof ArxivQueryInputSchema>
export type ArxivPaper = z.infer<typeof ArxivPaperSchema>
export type ArxivSearchResult = z.infer<typeof ArxivSearchResultSchema>

export type WebScraperInput = z.infer<typeof WebScraperInputSchema>
export type ScrapedContent = z.infer<typeof ScrapedContentSchema>

export type HybridSearchInput = z.infer<typeof HybridSearchInputSchema>
export type SearchResult = z.infer<typeof SearchResultSchema>
export type HybridSearchResult = z.infer<typeof HybridSearchResultSchema>

export type MemoryStoreInput = z.infer<typeof MemoryStoreInputSchema>
export type MemoryRetrieveInput = z.infer<typeof MemoryRetrieveInputSchema>
export type MemorySearchInput = z.infer<typeof MemorySearchInputSchema>
export type MemoryItem = z.infer<typeof MemoryItemSchema>

export type BraveSearchInput = z.infer<typeof BraveSearchInputSchema>
export type BraveSearchResult = z.infer<typeof BraveSearchResultSchema>
export type BraveSearchResponse = z.infer<typeof BraveSearchResponseSchema>

export type ToolError = z.infer<typeof ToolErrorSchema>

// ===== Research Tool Configuration =====

export interface ResearchToolConfig {
  name: string
  description: string
  version: string
  enabled: boolean
  rate_limit?: {
    requests_per_minute: number
    burst_limit: number
  }
  timeout_ms: number
  retry_config?: {
    max_retries: number
    retry_delay_ms: number
  }
}

export const DEFAULT_TOOL_CONFIGS: Record<string, ResearchToolConfig> = {
  arxiv_query: {
    name: 'ArXiv Query',
    description: 'Search and retrieve academic papers from ArXiv',
    version: '1.0.0',
    enabled: true,
    rate_limit: {
      requests_per_minute: 30,
      burst_limit: 5
    },
    timeout_ms: 30000,
    retry_config: {
      max_retries: 3,
      retry_delay_ms: 1000
    }
  },
  web_scraper: {
    name: 'Web Content Scraper',
    description: 'Extract content from web pages using Puppeteer',
    version: '1.0.0',
    enabled: true,
    rate_limit: {
      requests_per_minute: 10,
      burst_limit: 2
    },
    timeout_ms: 60000,
    retry_config: {
      max_retries: 2,
      retry_delay_ms: 2000
    }
  },
  hybrid_search: {
    name: 'Hybrid RAG Search',
    description: 'Multi-collection semantic and keyword search with reranking',
    version: '1.0.0',
    enabled: true,
    timeout_ms: 30000
  },
  memory_manager: {
    name: 'OpenMemory Manager',
    description: 'Store and retrieve user context and session data',
    version: '1.0.0',
    enabled: true,
    timeout_ms: 10000
  },
  brave_search: {
    name: 'Brave Web Search',
    description: 'Real-time web search using Brave Search API',
    version: '1.0.0',
    enabled: true,
    rate_limit: {
      requests_per_minute: 50,
      burst_limit: 10
    },
    timeout_ms: 15000
  }
}