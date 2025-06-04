# Variables
NODE_VERSION := 20
PNPM := pnpm
TSC := npx tsc
MCP_CONFIG := .mcp-servers.json
MCP_SERVER_TS := mcp/servers/research-server.ts
MCP_SERVER_CJS := mcp/servers/research-server.cjs
DATABASE_URL := file:./chatollama.sqlite
PORT := 3000

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[1;33m
BLUE := \033[0;34m
NC := \033[0m # No Color

.PHONY: help install setup build dev test clean docker mcp arxiv agent lint format

# Default target
help:
	@echo "$(BLUE)Enterprise Research Assistant - Available Commands$(NC)"
	@echo "================================================="
	@echo "$(GREEN)Setup & Installation:$(NC)"
	@echo "  make install     - Install all dependencies"
	@echo "  make setup       - Complete project setup (install + build + db)"
	@echo ""
	@echo "$(GREEN)Development:$(NC)"
	@echo "  make dev         - Start development server"
	@echo "  make build       - Build the entire project"
	@echo "  make clean       - Clean build artifacts"
	@echo ""
	@echo "$(GREEN)MCP & Research:$(NC)"
	@echo "  make mcp-build   - Build MCP research server"
	@echo "  make mcp-test    - Test MCP configuration"
	@echo "  make mcp-setup   - Setup MCP tools and config"
	@echo ""
	@echo "$(GREEN)API Testing:$(NC)"
	@echo "  make test-arxiv  - Test ArXiv API endpoint"
	@echo "  make test-agent  - Test Research Agent API"
	@echo "  make test-all    - Run all API tests"
	@echo ""
	@echo "$(GREEN)Database:$(NC)"
	@echo "  make db-setup    - Setup database"
	@echo "  make db-migrate  - Run database migrations"
	@echo "  make db-reset    - Reset database"
	@echo ""
	@echo "$(GREEN)Docker:$(NC)"
	@echo "  make docker-build - Build Docker images"
	@echo "  make docker-up   - Start with Docker Compose"
	@echo "  make docker-down - Stop Docker containers"
	@echo ""
	@echo "$(GREEN)Utilities:$(NC)"
	@echo "  make lint        - Run linting"
	@echo "  make format      - Format code"
	@echo "  make deps-check  - Check dependencies"

# ==========================================
# Setup & Installation
# ==========================================

install:
	@echo "$(BLUE)📦 Installing dependencies...$(NC)"
	@$(PNPM) install
	@echo "$(GREEN)✅ Dependencies installed$(NC)"

setup: install mcp-setup db-setup build
	@echo "$(GREEN)🎉 Project setup completed!$(NC)"
	@echo "$(YELLOW)Next steps:$(NC)"
	@echo "  1. Update your .env file with API keys"
	@echo "  2. Run: make dev"

# ==========================================
# Build & Development
# ==========================================

build: mcp-build
	@echo "$(BLUE)🔨 Building project...$(NC)"
	@$(PNPM) run build
	@echo "$(GREEN)✅ Build completed$(NC)"

dev: mcp-build
	@echo "$(BLUE)🚀 Starting development server...$(NC)"
	@$(PNPM) run dev

clean:
	@echo "$(BLUE)🧹 Cleaning build artifacts...$(NC)"
	@rm -rf .nuxt
	@rm -rf .output
	@rm -rf dist
	@rm -rf $(MCP_SERVER_CJS)
	@rm -rf node_modules/.cache
	@echo "$(GREEN)✅ Cleaned$(NC)"

# ==========================================
# MCP Research Server
# ==========================================

mcp-build:
	@echo "$(BLUE)🔧 Building MCP Research Server...$(NC)"
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
	@mv mcp/servers/research-server.js $(MCP_SERVER_CJS) 2>/dev/null || true
	@echo "$(GREEN)✅ MCP server built successfully as .cjs$(NC)"

mcp-test: mcp-build
	@echo "$(BLUE)🔍 Testing MCP configuration...$(NC)"
	@if [ ! -f "$(MCP_CONFIG)" ]; then \
		echo "$(RED)❌ MCP config file not found$(NC)"; \
		make mcp-setup; \
	fi
	@node test-mcp.mjs
	@echo "$(GREEN)✅ MCP test completed$(NC)"

mcp-setup:
	@echo "$(BLUE)⚙️ Setting up MCP configuration...$(NC)"
	@if [ ! -f "$(MCP_CONFIG)" ]; then \
		echo "Creating MCP configuration..."; \
		echo '{\n  "servers": {\n    "research-server": {\n      "command": "node",\n      "args": ["./mcp/servers/research-server.cjs"],\n      "transport": "stdio"\n    }\n  }\n}' > $(MCP_CONFIG); \
	fi
	@echo "$(GREEN)✅ MCP configuration ready$(NC)"

mcp-install:
	@echo "$(BLUE)📦 Installing MCP tools globally...$(NC)"
	@npm install -g @modelcontextprotocol/server-memory || echo "Already installed"
	@npm install -g @modelcontextprotocol/server-brave-search || echo "Already installed"
	@$(PNPM) add @modelcontextprotocol/sdk @langchain/mcp-adapters
	@echo "$(GREEN)✅ MCP tools installed$(NC)"

# ==========================================
# API Testing
# ==========================================

test-arxiv:
	@echo "$(BLUE)🔬 Testing ArXiv API...$(NC)"
	@echo "$(YELLOW)Test 1: Basic search$(NC)"
	@curl -s -X POST http://localhost:$(PORT)/api/research/arxiv \
		-H "Content-Type: application/json" \
		-d '{"keywords":["machine learning"],"max_results":3}' | jq . || echo "Server not running or error occurred"
	@echo "\n$(YELLOW)Test 2: Search with categories$(NC)"
	@curl -s -X POST http://localhost:$(PORT)/api/research/arxiv \
		-H "Content-Type: application/json" \
		-d '{"keywords":["neural networks"],"categories":["cs.AI"],"max_results":2}' | jq . || echo "Server not running or error occurred"

test-agent:
	@echo "$(BLUE)🤖 Testing Research Agent API...$(NC)"
	@echo "$(YELLOW)Test 1: Basic research query$(NC)"
	@curl -s -X POST http://localhost:$(PORT)/api/research/agent \
		-H "Content-Type: application/json" \
		-d '{"query":"machine learning papers","max_results":5}' | jq . || echo "Server not running or error occurred"
	@echo "\n$(YELLOW)Test 2: Complex research query$(NC)"
	@curl -s -X POST http://localhost:$(PORT)/api/research/agent \
		-H "Content-Type: application/json" \
		-d '{"query":"recent advances in transformer architectures","max_results":3}' | jq . || echo "Server not running or error occurred"

test-debug:
	@echo "$(BLUE)🐛 Testing ArXiv Debug endpoint...$(NC)"
	@curl -s -X POST http://localhost:$(PORT)/api/research/arxiv-debug \
		-H "Content-Type: application/json" \
		-d '{"query":"machine learning"}' | jq .

test-all: test-arxiv test-agent
	@echo "$(GREEN)✅ All API tests completed$(NC)"

# ==========================================
# Database Management
# ==========================================

db-setup:
	@echo "$(BLUE)🗄️ Setting up database...$(NC)"
	@$(PNPM) run prisma-generate
	@$(PNPM) run prisma-migrate
	@echo "$(GREEN)✅ Database setup completed$(NC)"

db-migrate:
	@echo "$(BLUE)🔄 Running database migrations...$(NC)"
	@$(PNPM) run prisma-migrate
	@echo "$(GREEN)✅ Migrations completed$(NC)"

db-reset:
	@echo "$(BLUE)🔄 Resetting database...$(NC)"
	@rm -f chatollama.sqlite chatollama.sqlite-journal
	@$(PNPM) run prisma-migrate
	@echo "$(GREEN)✅ Database reset completed$(NC)"

# ==========================================
# Docker Operations
# ==========================================

docker-build:
	@echo "$(BLUE)🐳 Building Docker images...$(NC)"
	@docker-compose build
	@echo "$(GREEN)✅ Docker images built$(NC)"

docker-up:
	@echo "$(BLUE)🐳 Starting Docker containers...$(NC)"
	@docker-compose up -d
	@echo "$(GREEN)✅ Containers started$(NC)"

docker-down:
	@echo "$(BLUE)🐳 Stopping Docker containers...$(NC)"
	@docker-compose down
	@echo "$(GREEN)✅ Containers stopped$(NC)"

docker-logs:
	@docker-compose logs -f

# ==========================================
# Code Quality
# ==========================================

lint:
	@echo "$(BLUE)🔍 Running linter...$(NC)"
	@$(PNPM) run lint || echo "No lint script found"

format:
	@echo "$(BLUE)✨ Formatting code...$(NC)"
	@$(PNPM) run format || echo "No format script found"

# ==========================================
# Development Utilities
# ==========================================

deps-check:
	@echo "$(BLUE)📋 Checking dependencies...$(NC)"
	@echo "Node.js version: $$(node --version)"
	@echo "pnpm version: $$(pnpm --version)"
	@echo "TypeScript version: $$(npx tsc --version)"
	@echo "Docker version: $$(docker --version 2>/dev/null || echo 'Not installed')"
	@echo "Docker Compose version: $$(docker-compose --version 2>/dev/null || echo 'Not installed')"

env-check:
	@echo "$(BLUE)🔧 Checking environment configuration...$(NC)"
	@if [ -f .env ]; then \
		echo "$(GREEN)✅ .env file exists$(NC)"; \
		echo "Environment variables:"; \
		grep -E '^[A-Z_]' .env | cut -d= -f1 | sort; \
	else \
		echo "$(YELLOW)⚠️ .env file not found$(NC)"; \
		echo "Copy .env.example to .env and configure your settings"; \
	fi

status:
	@echo "$(BLUE)📊 Project Status$(NC)"
	@echo "=================="
	@echo "MCP Server: $$([ -f $(MCP_SERVER_CJS) ] && echo '$(GREEN)Built$(NC)' || echo '$(RED)Not built$(NC)')"
	@echo "MCP Config: $$([ -f $(MCP_CONFIG) ] && echo '$(GREEN)Present$(NC)' || echo '$(RED)Missing$(NC)')"
	@echo "Database: $$([ -f chatollama.sqlite ] && echo '$(GREEN)Present$(NC)' || echo '$(RED)Missing$(NC)')"
	@echo "Dependencies: $$([ -d node_modules ] && echo '$(GREEN)Installed$(NC)' || echo '$(RED)Not installed$(NC)')"

# ==========================================
# Quick Start Commands
# ==========================================

quick-start: setup
	@echo "$(GREEN)🚀 Quick Start completed!$(NC)"
	@echo "$(BLUE)Starting development server...$(NC)"
	@make dev

# For first-time setup
first-time: clean install mcp-install mcp-setup db-setup mcp-build
	@echo "$(GREEN)🎉 First-time setup completed!$(NC)"
	@echo "$(YELLOW)Next steps:$(NC)"
	@echo "  1. Copy .env.example to .env"
	@echo "  2. Configure your API keys in .env"
	@echo "  3. Run: make dev"

# Development workflow
work: mcp-build dev

# Full test suite
test-full: mcp-test test-all
	@echo "$(GREEN)✅ Full test suite completed$(NC)"