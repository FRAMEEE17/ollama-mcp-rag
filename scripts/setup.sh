#!/bin/bash

echo "🔬 Setting up Enterprise Research Assistant..."
echo ""

# Create directories
echo "📁 Creating directories..."
mkdir -p mcp/servers/tools
mkdir -p mcp/schemas
mkdir -p mcp/client
mkdir -p research/agents
mkdir -p research/collections
mkdir -p research/retrievers
mkdir -p integrations/arxiv
mkdir -p integrations/memory
mkdir -p integrations/scrapers
mkdir -p server/api/research
mkdir -p server/utils/research
mkdir -p scripts/research

echo "✅ Directories created"

# Install MCP tools globally
echo ""
echo "📦 Installing MCP tools..."

# Core MCP tools
npm install -g @modelcontextprotocol/server-memory
npm install -g @modelcontextprotocol/server-brave-search
npm install -g @modelcontextprotocol/server-filesystem

echo "✅ MCP tools installed globally"

# Install research dependencies
echo ""
echo "📦 Installing research dependencies..."

pnpm add @modelcontextprotocol/sdk
pnpm add fast-xml-parser
pnpm add puppeteer
pnpm add cheerio
pnpm add dotenv

echo "✅ Research dependencies installed"

# Create .mcp-servers.json if it doesn't exist
if [ ! -f ".mcp-servers.json" ]; then
    echo ""
    echo "⚙️ Creating MCP configuration..."
    cat > .mcp-servers.json << 'EOF'
{
  "mcpServers": {
    "research-server": {
      "command": "node",
      "args": ["./mcp/servers/research-server.js"]
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"]
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    }
  }
}
EOF
    echo "✅ MCP configuration created"
else
    echo "⚠️ MCP configuration already exists"
fi

# Update .env if needed
echo ""
echo "🔧 Checking environment configuration..."

# Check if research variables exist in .env
if grep -q "MCP_SERVERS_CONFIG_PATH" .env; then
    echo "✅ Research environment variables already configured"
else
    echo "📝 Adding research environment variables..."
    cat >> .env << 'EOF'

# Research Assistant Configuration  
MCP_SERVERS_CONFIG_PATH=./.mcp-servers.json
RESEARCH_MODE=development
ARXIV_API_ENABLED=true
MEMORY_NAMESPACE=research-assistant
EOF
    echo "✅ Research environment variables added"
fi

# Check API keys
if grep -q "BRAVE_SEARCH_KEY=" .env; then
    echo "✅ BRAVE_SEARCH_KEY found in .env"
else
    echo "⚠️ BRAVE_SEARCH_KEY not found - please add it to .env"
fi

# Build research server
echo ""
echo "🔨 Building research server..."
if [ -f "scripts/build-research.sh" ]; then
    chmod +x scripts/build-research.sh
    ./scripts/build-research.sh
else
    echo "⚠️ Build script not found, attempting direct compilation..."
    if [ -f "mcp/servers/research-server.ts" ]; then
        npx tsc mcp/servers/research-server.ts --outDir mcp/servers/ --target ES2020 --module CommonJS --esModuleInterop --skipLibCheck
        echo "✅ Research server compiled"
    else
        echo "❌ research-server.ts not found"
    fi
fi

# Test ArXiv API
if curl -s "http://export.arxiv.org/api/query?search_query=ai&max_results=1" > /dev/null; then
    echo "✅ ArXiv API accessible"
else
    echo "⚠️ ArXiv API test failed (check internet connection)"
fi

# Test MCP tools
if command -v @modelcontextprotocol/server-memory > /dev/null; then
    echo "✅ MCP memory server installed"
else
    echo "⚠️ MCP memory server not found"
fi

echo ""
echo "🎉 Setup completed!"
echo ""
echo "📝 Next steps:"
echo "1. Update your .env file:"
echo "   - Add BRAVE_API_KEY (get from https://brave.com/search/api/)"
echo "   - Add OPENAI_API_KEY (for embeddings)"
echo ""
echo "2. Start development:"
echo "   pnpm dev"
echo ""
echo "3. Test research functionality:"
echo "   curl -X POST http://localhost:3000/api/research/query \\"
echo "     -H \"Content-Type: application/json\" \\"
echo "     -d '{\"query\": \"machine learning papers\"}'"
echo ""
echo "🌐 Access points:"
echo "   - Main app: http://localhost:3000"
echo "   - ChromaDB: http://localhost:8000"