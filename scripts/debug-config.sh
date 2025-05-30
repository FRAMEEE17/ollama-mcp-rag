#!/bin/bash

echo "🔍 Enterprise Research Assistant - Configuration Debug"
echo "=================================================="

# Check if server is running
echo "1. Server Status:"
if curl -s http://localhost:3000 > /dev/null; then
    echo "✅ Server is running"
else
    echo "❌ Server is not accessible"
    exit 1
fi

# Check available models
echo -e "\n2. Available Models by Family:"
echo "----------------------------------------"
curl -s http://localhost:3000/api/models | jq -r '.[] | "\(.details.family // "unknown"): \(.name)"' | sort | uniq -c

# Check environment variables
echo -e "\n3. Environment Variables:"
echo "----------------------------------------"
echo "NVIDIA_API_KEY: ${NVIDIA_API_KEY:+SET}"
echo "OPENAI_API_KEY: ${OPENAI_API_KEY:+SET}"
echo "VLLM_ENDPOINT: ${VLLM_ENDPOINT:-not set}"
echo "ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:+SET}"

# Check .env file
echo -e "\n4. .env File Check:"
echo "----------------------------------------"
if [ -f .env ]; then
    echo "✅ .env file exists"
    echo "NVIDIA entries:"
    grep -i nvidia .env || echo "❌ No NVIDIA entries found"
    echo "OPENAI entries:"
    grep -i openai .env || echo "❌ No OPENAI entries found"
else
    echo "❌ .env file not found"
fi

# Check Ollama
echo -e "\n5. Ollama Status:"
echo "----------------------------------------"
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama server accessible"
    echo "Available Ollama models:"
    curl -s http://localhost:11434/api/tags | jq -r '.models[]?.name' | head -5
else
    echo "❌ Ollama server not accessible"
fi

# Check MCP configuration
echo -e "\n6. MCP Configuration:"
echo "----------------------------------------"
if [ -f .mcp-servers.json ]; then
    echo "✅ MCP config file exists"
    echo "Configured servers:"
    jq -r '.mcpServers | keys[]' .mcp-servers.json 2>/dev/null || echo "❌ Invalid JSON in MCP config"
else
    echo "❌ MCP config file not found"
fi

# Test research endpoint basic connectivity
echo -e "\n7. Research Endpoint Test:"
echo "----------------------------------------"
response_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/research/agent \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}')

if [ "$response_code" = "200" ]; then
    echo "✅ Research endpoint accessible (HTTP $response_code)"
else
    echo "⚠️  Research endpoint returned HTTP $response_code"
fi

echo -e "\n8. Recommendations:"
echo "----------------------------------------"
echo "Based on the above diagnosis:"

# Check if any models are available
model_count=$(curl -s http://localhost:3000/api/models | jq length)
if [ "$model_count" -gt 0 ]; then
    echo "✅ You have $model_count models available"
    echo "🔧 Try testing with an available model first"
else
    echo "❌ No models found - check API keys or Ollama setup"
fi

echo "🔧 Next steps:"
echo "1. Configure at least one API key (NVIDIA/OpenAI) or install Ollama models"
echo "2. Restart the server after configuration changes"
echo "3. Test with available models first"