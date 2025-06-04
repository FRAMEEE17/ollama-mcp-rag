import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import fs from 'fs';

async function testMCP() {
    try {
        console.log('🔍 Testing MCP Configuration...');
        
        // Check if config file exists
        if (!fs.existsSync('.mcp-servers.json')) {
            console.error('❌ .mcp-servers.json not found');
            process.exit(1);
        }
        
        // Load and validate config
        const configContent = fs.readFileSync('.mcp-servers.json', 'utf8');
        const config = JSON.parse(configContent);
        
        console.log('📋 Config loaded:');
        console.log(JSON.stringify(config, null, 2));
        
        // Check config format
        if (!config.servers) {
            console.error('❌ Config missing "servers" property');
            if (config.mcpServers) {
                console.log('💡 Found legacy "mcpServers" format - please update to "servers"');
            }
            process.exit(1);
        }
        
        console.log(`✅ Found ${Object.keys(config.servers).length} server configurations`);
        
        console.log('\n🚀 Creating MCP client...');
        const client = MultiServerMCPClient.fromConfigFile('.mcp-servers.json');
        
        console.log('🔗 Initializing connections...');
        await client.initializeConnections();
        
        console.log('🛠️ Getting tools...');
        const tools = await client.getTools();
        
        console.log(`\n✅ Successfully loaded ${tools.length} tools:`);
        tools.forEach((tool, index) => {
            console.log(`   ${index + 1}. ${tool.name} - ${tool.description || 'No description'}`);
        });
        
        console.log('\n🧹 Closing connections...');
        await client.close();
        
        console.log('\n🎉 MCP test completed successfully!');
        
    } catch (error) {
        console.error('\n❌ MCP test failed:');
        console.error('Error:', error.message);
        console.error('Full error details:', error);
        process.exit(1);
    }
}

testMCP();
