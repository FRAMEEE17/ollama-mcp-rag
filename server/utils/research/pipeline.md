## Pipeline Overview:
```Direct ArXiv Search:
User Query → arxiv.post.ts → ArXiv API → Results
```
```
Intelligent Agent Search:
User Query → agent.post.ts → research-agent.ts → mcp.ts → research-server.js → Enhanced ArXiv Logic → Results + Summary
```
## Pipeline Breakdown:
Chat Interface (Main Flow):
Chat UI → models/chat/index.post.ts → mcp.ts → research-server.js → Enhanced ArXiv Logic → Chat Response


MCP Server Pipeline:
research-server.ts → (build) → research-server.js → MCP Protocol → Tools Available


## Key difference:

arxiv.post.ts = Direct API call
agent.post.ts = Smart orchestration with LLM reasoning
Chat = Uses agent automatically when research questions detected