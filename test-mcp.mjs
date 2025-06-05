import { spawn } from 'child_process';

async function testMCPProtocol() {
    console.log('🔬 Testing MCP Protocol Directly...');
    
    const serverProcess = spawn('node', ['./mcp/servers/research-server.cjs'], {
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let responses = [];
    let serverReady = false;
    
    serverProcess.stdout.on('data', (data) => {
        const response = data.toString().trim();
        console.log('📨 Server response:', response);
        responses.push(response);
    });
    
    serverProcess.stderr.on('data', (data) => {
        const log = data.toString().trim();
        console.log('📝 Server log:', log);
        if (log.includes('Enhanced server started successfully')) {
            serverReady = true;
        }
    });
    
    // Wait for server to start
    console.log('⏳ Waiting for server to start...');
    await new Promise(resolve => {
        const checkReady = () => {
            if (serverReady) {
                resolve();
            } else {
                setTimeout(checkReady, 100);
            }
        };
        checkReady();
    });
    
    console.log('✅ Server is ready, testing MCP calls...');
    
    // Test 1: Initialize
    console.log('\n🔧 Test 1: Initialize MCP');
    const initRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
                name: "test-client",
                version: "1.0.0"
            }
        }
    };
    
    serverProcess.stdin.write(JSON.stringify(initRequest) + '\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test 2: List Tools
    console.log('\n🛠️ Test 2: List Tools');
    const listToolsRequest = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
    };
    
    serverProcess.stdin.write(JSON.stringify(listToolsRequest) + '\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test 3: Call ArXiv Tool
    console.log('\n🔍 Test 3: Call ArXiv Tool');
    const callToolRequest = {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
            name: "arxiv_query",
            arguments: {
                keywords: ["machine learning"],
                max_results: 2
            }
        }
    };
    
    serverProcess.stdin.write(JSON.stringify(callToolRequest) + '\n');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Longer wait for ArXiv API
    
    // Analyze results
    console.log('\n📊 Analysis:');
    console.log(`📨 Total responses received: ${responses.length}`);
    
    const hasInitResponse = responses.some(r => r.includes('"result"') && r.includes('capabilities'));
    const hasToolsList = responses.some(r => r.includes('arxiv_query'));
    const hasToolResult = responses.some(r => r.includes('success') || r.includes('papers'));
    
    console.log(`🔧 Initialize response: ${hasInitResponse ? '✅' : '❌'}`);
    console.log(`🛠️ Tools list response: ${hasToolsList ? '✅' : '❌'}`);
    console.log(`🔍 ArXiv tool result: ${hasToolResult ? '✅' : '❌'}`);
    
    if (hasInitResponse && hasToolsList && hasToolResult) {
        console.log('\n🎉 MCP Protocol Test: SUCCESS!');
        console.log('✅ Research server is working correctly');
    } else {
        console.log('\n⚠️ MCP Protocol Test: PARTIAL');
        console.log('📄 All responses:');
        responses.forEach((r, i) => console.log(`${i + 1}:`, r));
    }
    
    // Clean up
    serverProcess.kill();
    console.log('🧹 Server process terminated');
}

testMCPProtocol().catch(console.error);