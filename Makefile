# Variables
NODE_VERSION := 20
PNPM := pnpm
TSC := npx tsc
MCP_SERVER_TS := mcp/servers/research-server.ts
MCP_SERVER_CJS := mcp/servers/research-server.cjs
DATABASE_URL := file:./chatollama.sqlite
PORT := 3000

# Colors
GREEN := \033[0;32m
YELLOW := \033[1;33m
BLUE := \033[0;34m
NC := \033[0m

.PHONY: help install setup build dev test clean

# Default target
help:
	@echo "$(BLUE)Research Assistant - Available Commands$(NC)"
	@echo "========================================="
	@echo "$(GREEN)Setup:$(NC)"
	@echo "  make install     - Install dependencies"
	@echo "  make setup       - Complete setup (install + build + db)"
	@echo "  make build       - Build everything"
	@echo ""
	@echo "$(GREEN)Development:$(NC)"
	@echo "  make dev         - Start development server"
	@echo "  make clean       - Clean build artifacts"
	@echo ""
	@echo "$(GREEN)Testing:$(NC)"
	@echo "  make test        - Run all tests"
	@echo "  make test-quick  - Quick integration test"
	@echo "  make test-mcp    - Test MCP server only"
	@echo "  make test-api    - Test API endpoints"
	@echo "  make test-chat   - Test chat endpoint"
	@echo ""
	@echo "$(GREEN)Build Components:$(NC)"
	@echo "  make mcp-build   - Build MCP server"
	@echo "  make db-setup    - Setup database"

# ===========================================
# Setup & Installation
# ===========================================

install:
	@echo "$(BLUE)📦 Installing dependencies...$(NC)"
	@$(PNPM) install
	@echo "$(GREEN)✅ Dependencies installed$(NC)"

setup: install mcp-build db-setup
	@echo "$(GREEN)🎉 Setup completed!$(NC)"
	@echo "$(YELLOW)Next: make dev$(NC)"

build: mcp-build
	@echo "$(BLUE)🔨 Building project...$(NC)"
	@$(PNPM) run build
	@echo "$(GREEN)✅ Build completed$(NC)"

# ===========================================
# Development
# ===========================================

dev: mcp-build
	@echo "$(BLUE)🚀 Starting development server...$(NC)"
	@$(PNPM) run dev

clean:
	@echo "$(BLUE)🧹 Cleaning...$(NC)"
	@rm -rf .nuxt .output dist node_modules/.cache
	@rm -f $(MCP_SERVER_CJS)
	@echo "$(GREEN)✅ Cleaned$(NC)"

# ===========================================
# MCP Server
# ===========================================

mcp-build:
	@echo "$(BLUE)🔧 Building MCP server...$(NC)"
	@if [ ! -f "$(MCP_SERVER_TS)" ]; then \
		echo "$(RED)❌ $(MCP_SERVER_TS) not found$(NC)"; \
		exit 1; \
	fi
	@$(TSC) $(MCP_SERVER_TS) \
		--target ES2018 \
		--module CommonJS \
		--esModuleInterop \
		--skipLibCheck \
		--outDir mcp/servers/ \
		--resolveJsonModule
	@if [ -f "mcp/servers/research-server.js" ]; then \
		mv mcp/servers/research-server.js $(MCP_SERVER_CJS); \
	fi
	@echo "$(GREEN)✅ MCP server built$(NC)"

# ===========================================
# Database
# ===========================================

db-setup:
	@echo "$(BLUE)🗄️ Setting up database...$(NC)"
	@$(PNPM) run prisma-generate
	@$(PNPM) run prisma-migrate
	@echo "$(GREEN)✅ Database ready$(NC)"

db-reset:
	@echo "$(BLUE)🔄 Resetting database...$(NC)"
	@rm -f chatollama.sqlite chatollama.sqlite-journal
	@$(PNPM) run prisma-migrate
	@echo "$(GREEN)✅ Database reset$(NC)"

# ===========================================
# Testing
# ===========================================

test: test-env test-mcp test-api test-chat
	@echo "$(GREEN)🎉 All tests completed!$(NC)"

test-quick:
	@echo "$(BLUE)⚡ Quick integration test...$(NC)"
	@node node test-integration.mjs

test-env:
	@echo "$(BLUE)🔍 Testing environment...$(NC)"
	@echo "Node: $$(node --version)"
	@echo "PNPM: $$(pnpm --version)"
	@if [ -f $(MCP_SERVER_CJS) ]; then \
		echo "$(GREEN)✅ MCP server built$(NC)"; \
	else \
		echo "$(YELLOW)⚠️ MCP server needs building$(NC)"; \
		make mcp-build; \
	fi

test-mcp: mcp-build
	@echo "$(BLUE)🤖 Testing MCP server...$(NC)"
	@node test-mcp.mjs

test-api:
	@echo "$(BLUE)🔗 Testing API endpoints...$(NC)"
	@echo "$(YELLOW)Testing ArXiv API...$(NC)"
	@curl -s -X POST http://localhost:$(PORT)/api/research/arxiv \
		-H "Content-Type: application/json" \
		-d '{"keywords":["meta/llama-3.1-8b-instruct"],"max_results":1}' | head -c 100 || echo "\n$(YELLOW)Server not running$(NC)"
	@echo "\n$(YELLOW)Testing Research Agent...$(NC)"
	@curl -s -X POST http://localhost:$(PORT)/api/research/agent \
		-H "Content-Type: application/json" \
		-d '{"query":"meta/llama-3.1-8b-instruct","max_results":1}' | head -c 100 || echo "\n$(YELLOW)Server not running$(NC)"

test-chat:
	@echo "$(BLUE)💬 Testing chat endpoint...$(NC)"
	@curl -s -X POST http://localhost:$(PORT)/api/models/chat \
		-H "Content-Type: application/json" \
		-H "x-chat-ollama-keys: {\"nvidia\":{\"key\":\"$$NVIDIA_API_KEY\"}}" \
		-d '{"model":"meta/llama-3.1-8b-instruct","family":"nvidia","messages":[{"role":"user","content":"test"}],"stream":false}' \
		| head -c 200 || echo "\n$(YELLOW)Server not running$(NC)"

# ===========================================
# Demo & Usage Examples
# ===========================================

demo-research:
	@echo "$(BLUE)🧪 Demo: Research Query$(NC)"
	@curl -X POST http://localhost:$(PORT)/api/models/chat \
		-H "Content-Type: application/json" \
		-H "x-chat-ollama-keys: {\"nvidia\":{\"key\":\"$$NVIDIA_API_KEY\"}}" \
		-d '{"model":"meta/llama-3.1-8b-instruct","family":"nvidia","messages":[{"role":"user","content":"help me find papers about machine learning"}],"stream":false}'

demo-simple:
	@echo "$(BLUE)🧪 Demo: Simple Chat$(NC)"
	@curl -X POST http://localhost:$(PORT)/api/models/chat \
		-H "Content-Type: application/json" \
		-H "x-chat-ollama-keys: {\"nvidia\":{\"key\":\"$$NVIDIA_API_KEY\"}}" \
		-d '{"model":"meta/llama-3.1-8b-instruct","family":"nvidia","messages":[{"role":"user","content":"Hello, how are you?"}],"stream":false}'

# ===========================================
# Utilities
# ===========================================

logs:
	@echo "$(BLUE)📋 Recent logs:$(NC)"
	@tail -n 50 ~/.pm2/logs/chat-ollama-error.log 2>/dev/null || echo "No PM2 logs found"

status:
	@echo "$(BLUE)📊 System Status$(NC)"
	@echo "=================="
	@echo "MCP Server: $$([ -f $(MCP_SERVER_CJS) ] && echo '$(GREEN)Built$(NC)' || echo '$(YELLOW)Missing$(NC)')"
	@echo "Database: $$([ -f chatollama.sqlite ] && echo '$(GREEN)Ready$(NC)' || echo '$(YELLOW)Missing$(NC)')"
	@echo "Dependencies: $$([ -d node_modules ] && echo '$(GREEN)Installed$(NC)' || echo '$(YELLOW)Missing$(NC)')"
	@echo "Server: $$(curl -s http://localhost:$(PORT)/ >/dev/null 2>&1 && echo '$(GREEN)Running$(NC)' || echo '$(YELLOW)Stopped$(NC)')"

fix:
	@echo "$(BLUE)🔧 Running fixes...$(NC)"
	@make clean
	@make install
	@make mcp-build
	@make db-setup
	@echo "$(GREEN)✅ Fixes applied$(NC)"

# Quick commands
install-quick: install
build-quick: mcp-build
test-all: test
dev-start: dev