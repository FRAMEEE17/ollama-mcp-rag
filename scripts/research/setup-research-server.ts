#!/usr/bin/env node

import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'

interface SetupConfig {
  projectRoot: string
  mcpConfigPath: string
  environmentFile: string
  buildResearchServer: boolean
  installDependencies: boolean
  createDirectories: boolean
}

class ResearchServerSetup {
  private config: SetupConfig

  constructor(config?: Partial<SetupConfig>) {
    this.config = {
      projectRoot: process.cwd(),
      mcpConfigPath: '.mcp-servers.json',
      environmentFile: '.env',
      buildResearchServer: true,
      installDependencies: true,
      createDirectories: true,
      ...config
    }
  }

  async setup(): Promise<void> {
    console.log('🚀 Setting up Enterprise Research Assistant MCP Server...\n')

    try {
      // Step 1: Create necessary directories
      if (this.config.createDirectories) {
        await this.createDirectories()
      }

      // Step 2: Install dependencies
      if (this.config.installDependencies) {
        await this.installDependencies()
      }

      // Step 3: Setup MCP configuration
      await this.setupMcpConfiguration()

      // Step 4: Setup environment variables
      await this.setupEnvironment()

      // Step 5: Build research server
      if (this.config.buildResearchServer) {
        await this.buildResearchServer()
      }

      // Step 6: Verify setup
      await this.verifySetup()

      console.log('\n✅ Research server setup completed successfully!')
      console.log('\n🎯 Next steps:')
      console.log('1. Update your .env file with API keys')
      console.log('2. Run: npm run dev')
      console.log('3. Test research functionality at http://localhost:3000')

    } catch (error) {
      console.error('\n❌ Setup failed:', error)
      process.exit(1)
    }
  }

  private async createDirectories(): Promise<void> {
    console.log('📁 Creating directory structure...')

    const directories = [
      'mcp',
      'mcp/servers',
      'mcp/servers/tools',
      'mcp/schemas',
      'mcp/client',
      'research',
      'research/agents',
      'research/collections',
      'research/retrievers',
      'research/workflows',
      'integrations',
      'integrations/arxiv',
      'integrations/memory',
      'integrations/scrapers',
      'server/api/research',
      'server/api/research/collections',
      'server/api/research/agents',
      'server/utils/research',
      'scripts/research'
    ]

    for (const dir of directories) {
      const fullPath = path.join(this.config.projectRoot, dir)
      try {
        await fs.mkdir(fullPath, { recursive: true })
        console.log(`  ✓ Created: ${dir}`)
      } catch (error) {
        console.log(`  ⚠️  Directory already exists: ${dir}`)
      }
    }
  }

  private async installDependencies(): Promise<void> {
    console.log('\n📦 Installing research dependencies...')

    const dependencies = [
      '@modelcontextprotocol/sdk',
      '@modelcontextprotocol/server-memory',
      '@modelcontextprotocol/server-brave-search',
      'arxiv-api',
      'puppeteer',
      'cheerio',
      'fast-xml-parser',
      'zod',
      'dotenv'
    ]

    try {
      await this.runCommand('pnpm', ['add', ...dependencies])
      console.log('  ✓ Dependencies installed successfully')
    } catch (error) {
      console.error('  ❌ Failed to install dependencies:', error)
      throw error
    }
  }

  private async setupMcpConfiguration(): Promise<void> {
    console.log('\n⚙️  Setting up MCP configuration...')

    const mcpConfig = {
      mcpServers: {
        "research-server": {
          command: "node",
          args: ["./mcp/servers/research-server.js"],
          env: {
            "ARXIV_API_ENABLED": "true",
            "BRAVE_API_KEY": "${BRAVE_API_KEY}",
            "MILVUS_URL": "${MILVUS_URL}",
            "OPENAI_API_KEY": "${OPENAI_API_KEY}",
            "RESEARCH_MODE": "development"
          }
        },
        "memory": {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-memory"],
          env: {
            "MEMORY_NAMESPACE": "research-assistant"
          }
        },
        "brave-search": {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-brave-search"],
          env: {
            "BRAVE_API_KEY": "${BRAVE_API_KEY}"
          }
        }
      }
    }

    const configPath = path.join(this.config.projectRoot, this.config.mcpConfigPath)
    await fs.writeFile(configPath, JSON.stringify(mcpConfig, null, 2))
    console.log(`  ✓ MCP configuration saved to: ${this.config.mcpConfigPath}`)
  }

  private async setupEnvironment(): Promise<void> {
    console.log('\n🔧 Setting up environment variables...')

    const envPath = path.join(this.config.projectRoot, this.config.environmentFile)
    
    // Check if .env already exists
    try {
      await fs.access(envPath)
      console.log('  ⚠️  .env file already exists, skipping creation')
      return
    } catch {
      // File doesn't exist, create it
    }

    const envContent = `# Enterprise Research Assistant Environment Variables

# MCP Configuration
MCP_SERVERS_CONFIG_PATH=./.mcp-servers.json

# API Keys (Required)
BRAVE_API_KEY=your_brave_api_key_here
OPENAI_API_KEY=your_openai_api_key_here

# Database Configuration
MILVUS_URL=http://localhost:19530
CHROMADB_URL=http://localhost:8000
DATABASE_URL=file:./chatollama.sqlite

# Research Configuration
RESEARCH_MODE=development
ARXIV_API_ENABLED=true
MAX_CONCURRENT_TOOLS=3
TOOL_TIMEOUT_MS=30000

# Memory Configuration
MEMORY_NAMESPACE=research-assistant
MEMORY_TTL=86400

# Scraping Configuration
PUPPETEER_HEADLESS=true
SCRAPER_TIMEOUT=30000
USER_AGENT=Enterprise-Research-Assistant/1.0

# Existing Chat-Ollama Variables
DISABLE_VERCEL_ANALYTICS=false
PORT=3000
HOST=
LANGCHAIN_TRACING_V2=false
NUXT_PUBLIC_CHAT_MAX_ATTACHED_MESSAGES=50
`

    await fs.writeFile(envPath, envContent)
    console.log(`  ✓ Environment template created: ${this.config.environmentFile}`)
    console.log('  ⚠️  Please update the API keys in your .env file')
  }

  private async buildResearchServer(): Promise<void> {
    console.log('\n🔨 Building research server...')

    try {
      // Build TypeScript files
      await this.runCommand('pnpm', ['build'])
      console.log('  ✓ Research server built successfully')
    } catch (error) {
      console.log('  ⚠️  Build step skipped (build command not found)')
    }
  }

  private async verifySetup(): Promise<void> {
    console.log('\n🔍 Verifying setup...')

    const checks = [
      { name: 'MCP configuration', path: this.config.mcpConfigPath },
      { name: 'Environment file', path: this.config.environmentFile },
      { name: 'MCP servers directory', path: 'mcp/servers' },
      { name: 'Research directory', path: 'research' },
      { name: 'Integrations directory', path: 'integrations' }
    ]

    for (const check of checks) {
      try {
        const fullPath = path.join(this.config.projectRoot, check.path)
        await fs.access(fullPath)
        console.log(`  ✓ ${check.name}: OK`)
      } catch (error) {
        console.log(`  ❌ ${check.name}: Missing`)
        throw new Error(`Setup verification failed: ${check.name} not found`)
      }
    }
  }

  private async runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, {
        stdio: 'pipe',
        shell: true
      })

      let output = ''
      let error = ''

      process.stdout?.on('data', (data) => {
        output += data.toString()
      })

      process.stderr?.on('data', (data) => {
        error += data.toString()
      })

      process.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${error}`))
        }
      })

      process.on('error', (err) => {
        reject(err)
      })
    })
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2)
  const config: Partial<SetupConfig> = {}

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--no-build':
        config.buildResearchServer = false
        break
      case '--no-deps':
        config.installDependencies = false
        break
      case '--no-dirs':
        config.createDirectories = false
        break
      case '--help':
        console.log(`
Enterprise Research Assistant Setup Script

Usage: node setup-research-server.js [options]

Options:
  --no-build    Skip building the research server
  --no-deps     Skip installing dependencies
  --no-dirs     Skip creating directories
  --help        Show this help message

Examples:
  node setup-research-server.js
  node setup-research-server.js --no-build
  node setup-research-server.js --no-deps --no-dirs
`)
        process.exit(0)
    }
  }

  const setup = new ResearchServerSetup(config)
  await setup.setup()
}

if (require.main === module) {
  main().catch(console.error)
}

export { ResearchServerSetup }