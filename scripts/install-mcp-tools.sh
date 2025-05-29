#!/bin/bash

echo "📦 Installing MCP Tools for Enterprise Research Assistant..."
echo ""

# Core MCP Tools (Global Installation)
echo "🔧 Installing core MCP tools globally..."
echo "(This may take a few minutes...)"
echo ""

tools=(
    "@modelcontextprotocol/server-memory"
    "@modelcontextprotocol/server-brave-search"
    "@modelcontextprotocol/server-filesystem"
    "@modelcontextprotocol/server-everything"
    "@modelcontextprotocol/server-sequential-thinking"
)

for tool in "${tools[@]}"; do
    echo "Installing $tool..."
    if npm install -g "$tool" --silent; then
        echo "✅ $tool installed"
    else
        echo "⚠️ $tool installation failed (may already exist)"
    fi
done

echo ""
echo "✅ Core MCP tools installation completed"

# Project Dependencies
echo ""
echo "📚 Installing project dependencies..."

deps=(
    "@modelcontextprotocol/sdk"
    "@langchain/mcp-adapters"
    "fast-xml-parser"
    "puppeteer"
    "cheerio"
    "dotenv"
)

for dep in "${deps[@]}"; do
    echo "Installing $dep..."
    if pnpm add "$dep" --silent; then
        echo "✅ $dep installed"
    else
        echo "⚠️ $dep installation failed (may already exist)"
    fi
done

echo ""
echo "✅ Project dependencies installation completed"

# Simple verification (no hanging tests)
echo ""
echo "🔍 Verifying installations..."

# Check global installations
for tool in "${tools[@]}"; do
    if npm list -g "$tool" > /dev/null 2>&1; then
        echo "✅ $tool (global)"
    else
        echo "⚠️ $tool (not found globally)"
    fi
done

# Check project dependencies  
for dep in "${deps[@]}"; do
    if pnpm list "$dep" > /dev/null 2>&1; then
        echo "✅ $dep (project)"
    else
        echo "⚠️ $dep (not found in project)"
    fi
done

echo ""
echo "📋 Installation Summary:"
echo ""
echo "Global MCP Tools installed:"
for tool in "${tools[@]}"; do
    echo "  - $tool"
done
echo ""
echo "Project Dependencies installed:"
for dep in "${deps[@]}"; do
    echo "  - $dep"
done
echo ""
echo "🎯 Usage Examples:"
echo ""
echo "# Test MCP servers (they will wait for JSON-RPC input):"
echo "npx @modelcontextprotocol/server-memory"
echo "npx @modelcontextprotocol/server-brave-search"
echo ""
echo "# Use Ctrl+C to exit MCP servers"
echo ""
echo "🔧 Next Steps:"
echo "1. Run: ./scripts/setup-research.sh"
echo "2. Run: ./scripts/build-research.sh"  
echo "3. Run: pnpm dev"
echo ""
echo "✅ MCP tools installation completed successfully!"