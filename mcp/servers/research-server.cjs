#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
class ArxivTool {
    constructor() {
        this.baseUrl = 'http://export.arxiv.org/api/query';
        this.userAgent = 'Enterprise-Research-Assistant/1.0';
        console.error('[Enhanced ArXiv Tool] Initialized');
    }
    async execute(args) {
        const startTime = Date.now();
        try {
            // Validate and structure params to match API
            const params = {
                keywords: Array.isArray(args.keywords) ? args.keywords :
                    args.query ? [args.query] : [],
                max_results: Math.min(args.max_results || 10, 50),
                recent_only: args.recent_only || false,
                days_back: args.days_back || 365,
                categories: Array.isArray(args.categories) ? args.categories : [],
                sort_by: args.sort_by || 'relevance'
            };
            console.error('[Enhanced ArXiv Tool] Executing with params:', params);
            // Build advanced search query
            const searchQuery = this.buildAdvancedQuery(params);
            const url = this.buildRequestUrl(searchQuery, params);
            console.error('[Enhanced ArXiv Tool] Request URL:', url.toString());
            // Execute API request
            const response = await fetch(url.toString(), {
                headers: {
                    'User-Agent': this.userAgent,
                    'Accept': 'application/atom+xml'
                }
            });
            if (!response.ok) {
                throw new Error(`ArXiv API failed: ${response.status} ${response.statusText}`);
            }
            const xmlText = await response.text();
            const allPapers = await this.parseArxivResponse(xmlText);
            // Apply scoring and filtering
            const scoredPapers = this.enhanceAndScore(allPapers, params.keywords);
            const finalPapers = scoredPapers.slice(0, params.max_results);
            const result = {
                success: true,
                papers: finalPapers,
                total_results: finalPapers.length,
                search_params: {
                    keywords: params.keywords,
                    recent_only: params.recent_only,
                    categories: params.categories,
                    sort_by: params.sort_by,
                    ...(params.recent_only && {
                        date_range: {
                            days_back: params.days_back,
                            start: new Date(Date.now() - params.days_back * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                            end: new Date().toISOString().split('T')[0]
                        }
                    })
                },
                execution_time: Date.now() - startTime,
                debug_info: {
                    original_results: allPapers.length,
                    final_query: searchQuery,
                    xml_length: xmlText.length
                },
                api_type: '_arxiv'
            };
            console.error(`[ArXiv Tool] Found ${finalPapers.length} papers in ${result.execution_time}ms`);
            return result;
        }
        catch (error) {
            console.error('[ArXiv Tool] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'ArXiv search failed',
                execution_time: Date.now() - startTime,
                api_type: '_arxiv'
            };
        }
    }
    buildAdvancedQuery(params) {
        // Build keyword query with OR logic
        const keywordQuery = params.keywords.length > 0
            ? params.keywords.map((k) => `"${k}"`).join(' OR ')
            : '';
        let searchQuery = keywordQuery ? `(${keywordQuery})` : '';
        // Add category filtering
        if (params.categories.length > 0) {
            const categoryFilter = params.categories.map((cat) => `cat:${cat}`).join(' OR ');
            searchQuery = searchQuery
                ? `(${searchQuery}) AND (${categoryFilter})`
                : `(${categoryFilter})`;
        }
        // Add date filtering for recent papers
        if (params.recent_only) {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - params.days_back);
            const startDateStr = startDate.toISOString().split('T')[0].replace(/-/g, '');
            const endDateStr = endDate.toISOString().split('T')[0].replace(/-/g, '');
            searchQuery = `submittedDate:[${startDateStr} TO ${endDateStr}] AND (${searchQuery})`;
        }
        return searchQuery || 'all:*';
    }
    buildRequestUrl(searchQuery, params) {
        const url = new URL(this.baseUrl);
        url.searchParams.set('search_query', searchQuery);
        url.searchParams.set('start', '0');
        url.searchParams.set('max_results', (params.max_results * 2).toString()); // Get more to filter
        // Set sort order
        if (params.sort_by === 'date') {
            url.searchParams.set('sortBy', 'submittedDate');
            url.searchParams.set('sortOrder', 'descending');
        }
        else {
            url.searchParams.set('sortBy', 'relevance');
            url.searchParams.set('sortOrder', 'descending');
        }
        return url;
    }
    enhanceAndScore(papers, keywords) {
        return papers.map(paper => {
            // Calculate relevance score
            let score = 0;
            const text = (paper.title + ' ' + paper.summary).toLowerCase();
            keywords.forEach(keyword => {
                const keywordLower = keyword.toLowerCase();
                const titleMatches = (paper.title.toLowerCase().match(new RegExp(keywordLower, 'g')) || []).length;
                const summaryMatches = (paper.summary.toLowerCase().match(new RegExp(keywordLower, 'g')) || []).length;
                score += titleMatches * 3 + summaryMatches * 1;
            });
            return {
                ...paper,
                relevance_score: score,
                keyword_matches: keywords.filter(k => text.includes(k.toLowerCase())),
                age_days: Math.floor((Date.now() - new Date(paper.published).getTime()) / (1000 * 60 * 60 * 24))
            };
        }).sort((a, b) => b.relevance_score - a.relevance_score);
    }
    async parseArxivResponse(xmlText) {
        try {
            const papers = [];
            const entryMatches = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || [];
            for (const entryXml of entryMatches) {
                try {
                    const paper = this.parseEntry(entryXml);
                    if (paper) {
                        papers.push(paper);
                    }
                }
                catch (error) {
                    console.error('[ ArXiv Tool] Parse entry error:', error);
                }
            }
            return papers;
        }
        catch (error) {
            console.error('[ArXiv Tool] XML parsing failed:', error);
            throw new Error('Failed to parse ArXiv response');
        }
    }
    parseEntry(entryXml) {
        try {
            const id = this.extractXmlField(entryXml, 'id')?.replace('http://arxiv.org/abs/', '') || '';
            const title = this.extractXmlField(entryXml, 'title')?.replace(/\s+/g, ' ').trim() || '';
            const summary = this.extractXmlField(entryXml, 'summary')?.replace(/\s+/g, ' ').trim() || '';
            const published = this.extractXmlField(entryXml, 'published') || '';
            const updated = this.extractXmlField(entryXml, 'updated') || '';
            // Extract authors
            const authorMatches = entryXml.match(/<name>([^<]+)<\/name>/g) || [];
            const authors = authorMatches.map(match => ({
                name: match.replace(/<\/?name>/g, '').trim()
            }));
            // Extract categories
            const categoryMatches = entryXml.match(/<category[^>]+term="([^"]+)"/g) || [];
            const categories = categoryMatches.map(match => {
                const termMatch = match.match(/term="([^"]+)"/);
                return termMatch ? termMatch[1] : '';
            }).filter(cat => cat);
            if (!id || !title)
                return null;
            return {
                id,
                title,
                summary,
                authors,
                published,
                updated,
                categories,
                pdf_url: `http://arxiv.org/pdf/${id}.pdf`,
                abstract_url: `http://arxiv.org/abs/${id}`
            };
        }
        catch (error) {
            console.error('[Enhanced ArXiv Tool] Entry parsing error:', error);
            return null;
        }
    }
    extractXmlField(xml, fieldName) {
        const regex = new RegExp(`<${fieldName}[^>]*>([\\s\\S]*?)<\\/${fieldName}>`, 'i');
        const match = xml.match(regex);
        return match ? match[1].trim() : null;
    }
}
class ResearchServer {
    constructor() {
        this.tools = new Map();
        this.server = new index_js_1.Server({
            name: 'research-server',
            version: '2.0.0',
            description: 'Enterprise Research Assistant MCP Server'
        }, {
            capabilities: {
                tools: {}
            }
        });
        this.setupTools();
        this.setupHandlers();
    }
    setupTools() {
        this.tools.set('arxiv_query', new ArxivTool());
        console.error('[Research Server] Registered enhanced tools:', Array.from(this.tools.keys()));
    }
    setupHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async (request) => {
            const tools = [
                {
                    name: 'arxiv_query',
                    description: ' ArXiv search with multiple keywords, categories, date filtering, and intelligent scoring',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            keywords: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Array of keywords to search for (e.g., ["RL", "LLM", "agents"])',
                                minItems: 1
                            },
                            max_results: {
                                type: 'number',
                                description: 'Maximum papers to retrieve (1-50)',
                                minimum: 1,
                                maximum: 50,
                                default: 10
                            },
                            recent_only: {
                                type: 'boolean',
                                description: 'Filter to recent papers only',
                                default: false
                            },
                            days_back: {
                                type: 'number',
                                description: 'Days back from today when recent_only=true',
                                minimum: 1,
                                maximum: 365,
                                default: 365
                            },
                            categories: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'ArXiv categories (e.g., ["cs.AI", "cs.LG", "cs.CL"])',
                                default: []
                            },
                            sort_by: {
                                type: 'string',
                                enum: ['relevance', 'date'],
                                description: 'Sort results by relevance or submission date',
                                default: 'relevance'
                            }
                        },
                        required: ['keywords']
                    }
                }
            ];
            return { tools };
        });
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                const tool = this.tools.get(name);
                if (!tool) {
                    throw new Error(`Unknown tool: ${name}`);
                }
                const result = await tool.execute(args);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2)
                        }
                    ]
                };
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: false,
                                error: error instanceof Error ? error.message : 'Unknown error',
                                tool_name: name
                            }, null, 2)
                        }
                    ],
                    isError: true
                };
            }
        });
    }
    async start() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error('[Research Server] server started successfully');
    }
}
async function main() {
    try {
        const server = new ResearchServer();
        await server.start();
    }
    catch (error) {
        console.error('[Research Server] Failed to start:', error);
        process.exit(1);
    }
}
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
if (require.main === module) {
    main().catch(console.error);
}
