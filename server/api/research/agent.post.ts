import { defineEventHandler, readBody } from 'h3'
import { createChatModel } from '@/server/utils/models'

interface RequestBody {
  query: string
  max_results?: number
  model?: string
  family?: string
}

interface ArxivParams {
  query: string
  max_results: number
  sort_by?: string
  sort_order?: string
}

export default defineEventHandler(async (event) => {
  let family = 'nvidia'; // Default value
  let model = 'meta/llama-3.1-8b-instruct'; // Default model
  
  try {
    console.log('[Research Agent] Starting...')
    
    const { 
      query, 
      max_results = 10, 
      model: requestModel = 'meta/llama-3.1-8b-instruct',
      family: requestFamily = 'nvidia'
    }: RequestBody = await readBody(event)
    
    // Update the variables with request values
    model = requestModel;
    family = requestFamily;
    
    if (!query) {
      throw new Error('Research query is required')
    }

    console.log(`[Research Agent] Using ${family.toUpperCase()} ${family === 'nvidia' ? 'API' : 'Server'} with ${model}`)
    console.log(`[Research Agent] Query: "${query}"`)
    
    // **FIX: Check if NVIDIA API key is available**
    if (family === 'nvidia') {
      const keys = event.context.keys;
      if (!keys?.nvidia?.key) {
        throw new Error('NVIDIA API key not configured. Please set your NVIDIA API key in settings.');
      }
      console.log('[Research Agent] NVIDIA API key found ✅');
    }
    
    // **FIX: Check if VLLM server is available**
    if (family === 'vllm') {
      const keys = event.context.keys;
      console.log('[Research Agent] VLLM endpoint:', keys?.vllm?.endpoint);
      
      // Test VLLM connection
      try {
        const testUrl = `${keys?.vllm?.endpoint || 'http://localhost:8694/v1'}/models`;
        const response = await fetch(testUrl, { 
          signal: AbortSignal.timeout(5000) 
        });
        if (!response.ok) {
          throw new Error(`VLLM server not accessible at ${testUrl}`);
        }
        console.log('[Research Agent] VLLM server accessible ✅');
      } catch (vllmError) {
        const errorMessage = vllmError instanceof Error ? vllmError.message : 'Unknown error';
        throw new Error(`VLLM server connection failed: ${errorMessage}`);
      }
    }
    
    const startTime = Date.now()

    // Create LLM instance (supports both NVIDIA API and VLLM local server)
    console.log(`[Research Agent] Creating ${family} model: ${model}`);
    const llm = createChatModel(model, family, event)
    
    // Extract search parameters using LLM
    const extractionPrompt = `
    You are a research assistant. Extract ArXiv search parameters from this query.

    Query: "${query}"

    IMPORTANT: ArXiv search works best with SIMPLE terms, not complex Boolean queries.

    Return ONLY valid JSON with these fields:
    - query: ONE simple search phrase (NO AND/OR operators, NO parentheses)
    - max_results: number between 5-20  
    - sort_by: "relevance" or "date"

    Examples:
    - For "machine learning papers": {"query": "machine learning", "max_results": 10, "sort_by": "relevance"}
    - For "neural networks and vision": {"query": "neural networks", "max_results": 10, "sort_by": "relevance"}
    - For "deep learning research": {"query": "deep learning", "max_results": 10, "sort_by": "relevance"}

    JSON:
    `

    console.log(`[Research Agent] 🧠 Extracting parameters with ${family.toUpperCase()}...`)
    const extractionResponse = await llm.invoke([['human', extractionPrompt]])
    console.log('[Research Agent] LLM Response:', extractionResponse.content)
    
    // Parse LLM response (works for both NVIDIA API & VLLM)
    let searchParams: ArxivParams
    try {
    const content = extractionResponse.content as string
    const jsonMatch = content.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        
        // FIXED: Clean up the query - remove complex operators
        let cleanQuery = parsed.query || query
        cleanQuery = cleanQuery
        .replace(/\s+AND\s+/gi, ' ')  // Remove AND operators
        .replace(/\s+OR\s+/gi, ' ')   // Remove OR operators
        .replace(/[()]/g, '')         // Remove parentheses
        .replace(/"/g, '')            // Remove quotes
        .replace(/\s+/g, ' ')         // Normalize spaces
        .trim()
        
        // Take only first 2-3 meaningful words
        interface QueryWord {
          length: number;
          toLowerCase(): string;
        }
        
        const words: string[] = cleanQuery.split(' ').filter((word: QueryWord) => 
          word.length > 2 && !['the', 'and', 'for', 'with'].includes(word.toLowerCase())
        )
        cleanQuery = words.slice(0, 3).join(' ')
        
        searchParams = {
        query: cleanQuery,  // Use cleaned query instead of parsed.query
        max_results: Math.min(Math.max(parsed.max_results || max_results, 5), 20),
        sort_by: parsed.sort_by || 'relevance',
        sort_order: 'descending'
        }
        console.log('[Research Agent] ✅ Cleaned search params:', searchParams)
    } else {
        throw new Error(`No JSON found in ${family.toUpperCase()} response`)
    }
    } catch (parseError) {
    console.log('[Research Agent] ⚠️ JSON parse failed, using fallback params')
    // Use simple fallback - just first 2 words of original query
    const simpleQuery = query.split(' ').slice(0, 2).join(' ')
    searchParams = {
        query: simpleQuery,  // Simple fallback query
        max_results: Math.min(max_results, 15),
        sort_by: 'relevance', 
        sort_order: 'descending'
    }
    }

    // Execute ArXiv search via direct API (bypassing MCP)
    console.log('[Research Agent] 🔍 Executing ArXiv search via direct API...')

    const arxivResponse = await fetch('http://localhost:3000/api/research/arxiv', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        keywords: [searchParams.query],
        max_results: searchParams.max_results,
        sort_by: searchParams.sort_by
      })
    })

    if (!arxivResponse.ok) {
      throw new Error(`ArXiv API failed: ${arxivResponse.status}`)
    }

    const searchResultRaw = await arxivResponse.json()

    if (!searchResultRaw.success) {
      throw new Error(searchResultRaw.error || 'ArXiv search failed')
    }

    // Format the result to match what the summary expects
    const searchResult = {
      content: JSON.stringify(searchResultRaw.papers, null, 2)
    }

    console.log('[Research Agent] ✅ Search completed')

    // Generate summary
    const summaryPrompt = `
You are an expert research analyst. Analyze these ArXiv papers and create a comprehensive research summary.

RESEARCH PAPERS DATA:
${searchResult.content}

Create a well-structured analysis with these sections:

## 🎯 Research Overview
- Brief field summary and current state
- Key themes and focus areas
- Timeline of recent developments

## 📊 Key Papers Analysis
For the 3-5 most important papers:
**[Paper Title]** by [Authors]
- 🔬 **Core Contribution**: What's new/innovative
- 🛠️ **Methodology**: Approach used  
- 📈 **Results**: Key findings/performance
- 🎯 **Relevance**: Why this matters

## 🔍 Research Trends & Patterns
- **Emerging Methods**: New techniques being adopted
- **Popular Approaches**: What's working well
- **Research Gaps**: What's missing/needed
- **Future Directions**: Where the field is heading

## 💡 Practical Applications
- Real-world use cases and commercial potential
- Industry adoption possibilities
- Implementation considerations

## 🚀 Actionable Recommendations
- **Must-read papers** (priority order)
- **Research opportunities** for new work
- **Related areas** to explore
- **Tools/datasets** mentioned

Keep the analysis concise but insightful for both researchers and practitioners.
`

    console.log(`[Research Agent] 🧠 Generating comprehensive summary with ${family.toUpperCase()}...`)
    const summaryResponse = await llm.invoke([['human', summaryPrompt]])
      
    const executionTime = Date.now() - startTime
    console.log(`[Research Agent] ✅ Research completed in ${executionTime}ms using ${family.toUpperCase()} ${model}`)

    return {
      success: true,
      query: searchParams.query,
      model_used: `${family}/${model}`,
      papers: searchResult.content,
      summary: summaryResponse.content,
      execution_time: executionTime,
      search_params: searchParams,
      papers_found: searchParams.max_results,
      provider: family === 'nvidia' ? 'NVIDIA API (Cloud)' : 'VLLM (Local Server)',
      cost_estimate: family === 'nvidia' ? 'Pay-per-token pricing' : 'Local compute only'
    }

  } catch (error) {
    console.error('[Research Agent] ❌ Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Research agent failed',
      papers: [],
      summary: `Research analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      execution_time: 0,
      details: error instanceof Error ? error.stack : 'Unknown error',
      provider: family === 'nvidia' ? 'NVIDIA API' : 'VLLM Local',
      troubleshooting: {
        nvidia_issues: family === 'nvidia' ? 'Ensure NVIDIA API key is set in settings' : 'N/A',
        vllm_issues: family === 'vllm' ? 'Check VLLM server is running and accessible' : 'N/A', 
        mcp_check: 'Direct ArXiv API used (MCP bypassed)',
        model_check: 'Confirm model is available on selected provider'
      }
    }
  }
})