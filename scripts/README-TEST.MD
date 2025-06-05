# MCP Testing Guide

## 🔍 Testing Strategy Overview

We have 4 levels that need testing:
1. **MCP Server** - Basic MCP protocol communication
2. **MCP Tools** - Individual tool functionality  
3. **Agent Integration** - Smart orchestration
4. **Chat Interface** - End-to-end user experience

---

## 1. 🛠️ Test MCP Server Basic Functionality

### Check MCP Configuration
```bash
# Verify config file exists and is valid
cat .mcp-servers.json | jq .

# Should show your research-server configuration
```

### Test MCP Server Connection
```bash
# Test MCP server directly (will wait for JSON-RPC input)
node ./mcp/servers/research-server.cjs

# Or test via the built-in test script
node test-mcp.mjs
```

### Debug MCP Status via API
```bash
# Check MCP connection health
curl -X GET http://localhost:3000/api/research/debug-mcp
```

**Expected Output:**
```json
{
  "success": true,
  "tools_count": 1,
  "tool_names": ["arxiv_query"],
  "arxiv_available": true,
  "mcp_status": {
    "isInitialized": true,
    "hasActiveClient": true
  }
}
```

---

## 2. 🔧 Test Individual MCP Tools

### Test ArXiv Tool Directly
```bash
# Test ArXiv API endpoint (bypasses MCP for comparison)
curl -X POST http://localhost:3000/api/research/arxiv \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["machine learning"],
    "max_results": 3
  }'
```

**Expected Output:**
```json
{
  "success": true,
  "papers": [
    {
      "id": "2024.xxxxx",
      "title": "Some ML Paper Title",
      "summary": "Paper abstract...",
      "authors": [{"name": "Author Name"}],
      "pdf_url": "http://arxiv.org/pdf/2024.xxxxx.pdf"
    }
  ],
  "total_results": 3,
  "execution_time": 1500
}
```

### Test ArXiv Debug Endpoint
```bash
# Test raw ArXiv API connectivity
curl -X POST http://localhost:3000/api/research/arxiv-debug \
  -H "Content-Type: application/json" \
  -d '{"query": "machine learning"}'
```

---

## 3. 🤖 Test Research Agent

### Test Research Agent API
```bash
# Test the intelligent research agent
curl -X POST http://localhost:3000/api/research/agent \
  -H "Content-Type: application/json" \
  -H "x-chat-ollama-keys: eyJudmlkaWEiOnsia2V5IjoibnZhcGktd3Bma2lDQWNGM29aRnZVblRaRVoxelFuNmh1STZuRU1UZzJSSVJnRVAyWVFRSWFQSW9FM0xDZmxFaFA4ZHJCdyJ9fQo" \
  -d '{
    "query": "recent advances in transformer architectures",
    "family": "nvidia",
    "model": "meta/llama-3.1-8b-instruct",
    "max_results": 5
  }'
```

**Expected Output:**
```json
{
  "success": true,
  "query": "transformer architectures",
  "model_used": "nvidia/meta/llama-3.1-8b-instruct",
  "papers": "JSON with paper data...",
  "summary": "Comprehensive analysis of recent transformer advances...",
  "execution_time": 3500,
  "papers_found": 5,
  "provider": "NVIDIA API (Cloud)"
}
```

### Test Different Query Types
```bash
# Test Thai query
curl -X POST http://localhost:3000/api/research/agent \
  -H "Content-Type: application/json" \
  -H "x-chat-ollama-keys: eyJudmlkaWEiOnsia2V5IjoibnZhcGktd3Bma2lDQWNGM29aRnZVblRaRVoxelFuNmh1STZuRU1UZzJSSVJnRVAyWVFRSWFQSW9FM0xDZmxFaFA4ZHJCdyJ9fQo" \
  -d '{
    "query": "งานวิจัยเกี่ยวกับปัญญาประดิษฐ์",
    "family": "nvidia",
    "model": "meta/llama-3.1-8b-instruct"
  }'

# Test English query  
curl -X POST http://localhost:3000/api/research/agent \
  -H "Content-Type: application/json" \
  -H "x-chat-ollama-keys: eyJudmlkaWEiOnsia2V5IjoibnZhcGktd3Bma2lDQWNGM29aRnZVblRaRVoxelFuNmh1STZuRU1UZzJSSVJnRVAyWVFRSWFQSW9FM0xDZmxFaFA4ZHJCdyJ9fQo" \
  -d '{
    "query": "deep learning papers",
    "family": "nvidia", 
    "model": "meta/llama-3.1-8b-instruct"
  }'
```

---

## 4. 💬 Test Chat Interface Integration

### Test Thai Research Queries
```bash
# Test research detection in chat
curl -X POST http://localhost:3000/api/models/chat \
  -H "Content-Type: application/json" \
  -H "x-chat-ollama-keys: eyJudmlkaWEiOnsia2V5IjoibnZhcGktd3Bma2lDQWNGM29aRnZVblRaRVoxelFuNmh1STZuRU1UZzJSSVJnRVAyWVFRSWFQSW9FM0xDZmxFaFA4ZHJCdyJ9fQo" \
  -d '{
    "model": "meta/llama-3.1-8b-instruct",
    "family": "nvidia",
    "messages": [{"role": "user", "content": "ช่วยหาเปเปอร์เกี่ยวกับ deep learning หน่อย"}],
    "stream": false
  }'
```

### Test English Research Queries
```bash
# Test English research detection
curl -X POST http://localhost:3000/api/models/chat \
  -H "Content-Type: application/json" \
  -H "x-chat-ollama-keys: eyJudmlkaWEiOnsia2V5IjoibnZhcGktd3Bma2lDQWNGM29aRnZVblRaRVoxelFuNmh1STZuRU1UZzJSSVJnRVAyWVFRSWFQSW9FM0xDZmxFaFA4ZHJCdyJ9fQo" \
  -d '{
    "model": "meta/llama-3.1-8b-instruct", 
    "family": "nvidia",
    "messages": [{"role": "user", "content": "find me some machine learning research papers"}],
    "stream": false
  }'
```

### Test Non-Research Queries (Should Not Trigger Tools)
```bash
# Test normal conversation (should not use MCP tools)
curl -X POST http://localhost:3000/api/models/chat \
  -H "Content-Type: application/json" \
  -H "x-chat-ollama-keys: eyJudmlkaWEiOnsia2V5IjoibnZhcGktd3Bma2lDQWNGM29aRnZVblRaRVoxelFuNmh1STZuRU1UZzJSSVJnRVAyWVFRSWFQSW9FM0xDZmxFaFA4ZHJCdyJ9fQo" \
  -d '{
    "model": "meta/llama-3.1-8b-instruct",
    "family": "nvidia", 
    "messages": [{"role": "user", "content": "What is the weather like today?"}],
    "stream": false
  }'
```

### Test Streaming Mode
```bash
# Test streaming research response
curl -X POST http://localhost:3000/api/models/chat \
  -H "Content-Type: application/json" \
  -H "x-chat-ollama-keys: eyJudmlkaWEiOnsia2V5IjoibnZhcGktd3Bma2lDQWNGM29aRnZVblRaRVoxelFuNmh1STZuRU1UZzJSSVJnRVAyWVFRSWFQSW9FM0xDZmxFaFA4ZHJCdyJ9fQo" \
  -d '{
    "model": "meta/llama-3.1-8b-instruct",
    "family": "nvidia",
    "messages": [{"role": "user", "content": "help me find papers about neural networks"}],
    "stream": true
  }'
```

---

## 5. Debugging

### Check Server Logs
```bash
# Monitor server logs while testing
tail -f ~/.pm2/logs/nuxt-out.log

# Or if running directly:
pnpm dev
# (Watch console output during tests)
```

### Verify MCP Tools Loading
Look for these log messages:
```
[MCP Pool] Initialized with X tools: arxiv_query
[Research Server] Enhanced server started successfully  
[Manual Tool] Available tools: arxiv_query
```

### Check Tool Execution
Look for these log patterns:
```
[Manual Tool] Detected research query, using ArXiv tool via MCP
[MCP Pool] Executing tool: arxiv_query with args: {...}
[MCP Pool] ✅ Tool arxiv_query completed
```

---

## 6. Complete Integration Test Script

Create a test script to verify everything:

```bash
#!/bin/bash
echo "🧪 Running Complete MCP Integration Tests"

# Test 1: MCP Server Health
echo "1. Testing MCP Server Health..."
HEALTH=$(curl -s http://localhost:3000/api/research/debug-mcp)
echo "MCP Health: $HEALTH"

# Test 2: Direct ArXiv API
echo "2. Testing Direct ArXiv API..."
ARXIV=$(curl -s -X POST http://localhost:3000/api/research/arxiv \
  -H "Content-Type: application/json" \
  -d '{"keywords":["AI"],"max_results":1}')
echo "ArXiv Test: $(echo $ARXIV | jq .success)"

# Test 3: Research Agent
echo "3. Testing Research Agent..."
AGENT=$(curl -s -X POST http://localhost:3000/api/research/agent \
  -H "Content-Type: application/json" \
  -H "x-chat-ollama-keys: eyJudmlkaWEiOnsia2V5IjoibnZhcGktd3Bma2lDQWNGM29aRnZVblRaRVoxelFuNmh1STZuRU1UZzJSSVJnRVAyWVFRSWFQSW9FM0xDZmxFaFA4ZHJCdyJ9fQo=" \
  -d '{"query":"AI papers","family":"nvidia","model":"meta/llama-3.1-8b-instruct"}')
echo "Agent Test: $(echo $AGENT | jq .success)"

# Test 4: Chat Interface
echo "4. Testing Chat Interface..."
CHAT=$(curl -s -X POST http://localhost:3000/api/models/chat \
  -H "Content-Type: application/json" \
  -H "x-chat-ollama-keys: eyJudmlkaWEiOnsia2V5IjoibnZhcGktd3Bma2lDQWNGM29aRnZVblRaRVoxelFuNmh1STZuRU1UZzJSSVJnRVAyWVFRSWFQSW9FM0xDZmxFaFA4ZHJCdyJ9fQo=" \
  -d '{"model":"meta/llama-3.1-8b-instruct","family":"nvidia","messages":[{"role":"user","content":"find ML papers"}],"stream":false}')
echo "Chat Test: Success if response contains research content"

echo "✅ All tests completed!"
```

---

## 7. ❌ Common Issues & Solutions

### Issue: MCP Server Not Starting
```bash
# Check if research-server.cjs exists
ls -la mcp/servers/research-server.cjs

# Rebuild if missing
make mcp-build
# or
npx tsc mcp/servers/research-server.ts --outDir mcp/servers/ --target ES2020 --module CommonJS
```

### Issue: Tools Not Loading
```bash
# Check MCP config format
cat .mcp-servers.json | jq .mcpServers

# Should have research-server entry
```

### Issue: ArXiv API Failing
```bash
# Test direct ArXiv API
curl "http://export.arxiv.org/api/query?search_query=machine+learning&max_results=1"

# Should return XML response
```

### Issue: NVIDIA API Key Problems
```bash
# Decode and check your keys
echo "eyJudmlkaWEiOnsia2V5IjoibnZhcGktd3Bma2lDQWNGM29aRnZVblRaRVoxelFuNmh1STZuRU1UZzJSSVJnRVAyWVFRSWFQSW9FM0xDZmxFaFA4ZHJCdyJ9fQo=" | base64 -d | jq .

# Should show nvidia.key field
```

---

## 8. 📊 Success Indicators

### Everything Working Correctly When You See:

1. **MCP Server**: JSON with `"arxiv_available": true`
2. **Tools**: ArXiv returns papers with titles and abstracts
3. **Agent**: Returns both papers and intelligent summary
4. **Chat**: Research queries trigger tool execution and return relevant papers
5. **Logs**: Show tool detection and execution messages

### Expected Flow:

```
User Query → Research Detection → MCP Tool → ArXiv API → Papers → LLM Summary → User Response
```

Run these tests in order to isolate any issues in your MCP pipeline!