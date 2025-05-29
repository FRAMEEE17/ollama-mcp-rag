import path from 'path'
import fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'

// // TODO: Setup minimal environment for MCP testing
// process.env.NODE_ENV = 'development'

// TODO: Load environment variables from .env file manually
const loadEnvFile = () => {
    const envPath = path.join(process.cwd(), '.env')
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8')
        envContent.split('\n').forEach(line => {
            const trimmedLine = line.trim()
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const [key, ...valueParts] = trimmedLine.split('=')
                if (key && valueParts.length > 0) {
                    const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '')
                    if (!process.env[key]) {
                        process.env[key] = value
                    }
                }
            }
        })
        console.log('Environment variables loaded from .env')
    }
}

loadEnvFile()

const execAsync = promisify(exec)

async function testMCP(): Promise<void> {
    console.log('Testing MCP Tools Integration...\n')
    
    try {
        console.log('1. Testing MCP Configuration...')
        await testMcpConfig()
        
        console.log('\n2. Testing MCP Servers Installation...')
        await testMcpServers()
        
        console.log('\n3. Testing Environment Variables...')
        testEnvironmentVars()
        
        console.log('\n4. Testing MCP Service File...')
        testMcpServiceFile()
        
        console.log('\nMCP Test Complete!')
        console.log('\nNext Steps:')
        console.log('1. Install any missing servers shown above')
        console.log('2. Run: pnpm dev')
        console.log('3. Test in chat: "Remember I\'m working on ML pipeline"')
        
    } catch (error) {
        console.error('MCP Test Failed:', (error as Error).message)
        console.log('\nTroubleshooting:')
        console.log('1. npm install -g @modelcontextprotocol/server-memory @modelcontextprotocol/server-everything')
        console.log('2. Check .mcp-servers.json has only working servers')
    }
}

// TODO: Test MCP configuration file
async function testMcpConfig(): Promise<void> {
    const configPath = process.env.MCP_SERVERS_CONFIG_PATH || path.join(process.cwd(), '.mcp-servers.json')
    
    console.log('   Config path:', configPath)
    
    if (!fs.existsSync(configPath)) {
        console.log('   Status: Config file missing')
        return
    }
    
    try {
        const configContent = fs.readFileSync(configPath, 'utf8')
        const config = JSON.parse(configContent)
        
        console.log('   Status: Config file valid')
        console.log('   Servers configured:', Object.keys(config.mcpServers || {}).length)
        
        // TODO: Show server status
        const workingServers = ['memory', 'everything', 'filesystem', 'brave-search']
        Object.keys(config.mcpServers || {}).forEach(serverName => {
            const isWorking = workingServers.includes(serverName)
            const status = isWorking ? '✓' : '✗ (may not exist)'
            console.log(`     ${status} ${serverName}`)
        })
        
    } catch (error) {
        console.log('   Status: Config file invalid -', (error as Error).message)
    }
}

// TODO: Test MCP server installation using simple npm check
async function testMcpServers(): Promise<void> {
    const serversToTest = [
        '@modelcontextprotocol/server-memory',
        '@modelcontextprotocol/server-everything',
        '@modelcontextprotocol/server-filesystem',
        '@modelcontextprotocol/server-brave-search'
    ]
    
    for (const server of serversToTest) {
        try {
            // Simple check without complex error handling
            await execAsync(`npm list -g ${server}`)
            console.log(`   ✓ ${server}`)
        } catch {
            console.log(`   ✗ ${server} (not installed)`)
        }
    }
}

// TODO: Check environment variables
function testEnvironmentVars(): void {
    const vars = {
        'MCP_SERVERS_CONFIG_PATH': process.env.MCP_SERVERS_CONFIG_PATH || 'default',
        'BRAVE_API_KEY': process.env.BRAVE_SEARCH_KEY ? 'set' : 'not set'
    }
    
    Object.entries(vars).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`)
    })
}

// TODO: Check MCP service file
function testMcpServiceFile(): void {
    const mcpPath = path.join(process.cwd(), 'server/utils/mcp.ts')
    
    if (fs.existsSync(mcpPath)) {
        console.log('   ✓ MCP service file exists')
        const content = fs.readFileSync(mcpPath, 'utf8')
        const hasClass = content.includes('McpService')
        console.log(`   ${hasClass ? '✓' : '✗'} Contains McpService class`)
    } else {
        console.log('   ✗ MCP service file missing')
    }
}

// Run test
testMCP().catch(console.error)