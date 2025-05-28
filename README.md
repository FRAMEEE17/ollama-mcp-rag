# Enterprise Research Assistant Project - Comprehensive Description

This project is an Enterprise Research Assistant built on a sophisticated MCP (Model Context Protocol) architecture designed to revolutionize how researchers, academics, and enterprise professionals conduct information discovery and analysis. The system employs a self-hosting AI application using Open-WebUI as the primary interface, integrated with an intelligent agent powered by Gemma LLM that orchestrates multiple specialized tools through a unified MCP client. At its core, the architecture features a single MCP server that manages five distinct but interconnected tools: an Automated Dynamic Web Scraper using Puppeteer for real-time content extraction from dynamic websites, a Query Paper tool that interfaces with ArXiv API to access academic literature, a RAG (Retrieval-Augmented Generation) Hybrid Search engine that combines vector similarity search with keyword-based retrieval and advanced reranking algorithms, a Smart Cache Manager for long-term memory and session optimization, and a Multimodal Web Search tool leveraging Brave Search API for comprehensive real-time information gathering.
The system's intelligence lies in its hybrid RAG implementation within the search component, which operates on multiple specialized collections stored in Milvus vector database, including academic papers from ArXiv, enterprise documents such as annual reports and financial data, technical documentation, web content, and personalized user personas. This RAG engine performs semantic vector searches alongside traditional keyword matching, then employs sophisticated fusion algorithms and relevance reranking to deliver contextually rich results. The agent workflow follows a three-phase process: first, Gemma LLM analyzes incoming queries to determine optimal tool selection and orchestration strategy; second, the selected MCP tools execute in parallel or sequence to gather information from various sources including live APIs, vector databases, and cached content; third, the agent synthesizes all retrieved information into comprehensive, well-sourced responses with proper attribution and context.

The systems architecture is designed for both research depth and enterprise scalability, utilizing Milvus for high-performance vector operations across multiple domain-specific collections (AI research papers, security intelligence, MLOps documentation, infrastructure guides, and financial reports), OpenMemory for persistent user context and conversation continuity, and a multi-tier caching strategy that includes session management, query result caching, and long-term user preference learning. External integrations include ArXiv API for real-time academic paper access, Brave Search API for comprehensive web coverage, and Puppeteer-based web scraping for dynamic content that requires JavaScript rendering. The entire system is engineered as a monolithic but modular architecture that can quickly demonstrate multi-agent capabilities while maintaining the flexibility to scale into microservices as requirements grow.
The project's core value proposition addresses the critical need for intelligent research automation in both academic and enterprise contexts, providing capabilities that span from literature reviews and competitive intelligence to technical documentation analysis and trend identification. Unlike traditional RAG systems that focus solely on document retrieval, this architecture implements agentic tool orchestration where the AI agent makes intelligent decisions about which tools to employ, how to combine their outputs, and how to present synthesized insights that maintain source attribution and context relevance. The system is particularly designed for multi-domain expertise, capable of seamlessly transitioning between academic research, financial analysis, technical documentation, security intelligence, and infrastructure planning within a single conversational interface, making it an ideal solution for research professionals, graduate students, financial analysts, and enterprise teams who require rapid access to high-quality, well-sourced information across diverse knowledge domains.

## Quick Start

As a user of `ChatOllama`, please walk through the document below, to make sure you get all the components up and running before starting using `ChatOllama`.

### Supported Vector Databases

`ChatOllama` supported 2 types of vector databases: Milvus and Chroma.

Please refer to the `.env.example` for how to work with your vector database setup.

```
# Supported values: chroma, milvus
VECTOR_STORE=chroma
CHROMADB_URL=http://localhost:8000
MILVUS_URL=http://localhost:19530
```

By default `ChatOllama` is using Chroma. If you'd like to use Milvus, set `VECTOR_STORE` to `milvus` and specify the corresponding URL. It works both in the development server and Docker containers.

### Use with Nuxt 3 Development Server

If you'd like to run with the latest code base and apply changes as needed, you can clone this repository and follow the steps below.

1. Install and run Ollama server

    You will need an Ollama server running. Follow the installation guide of [Ollama](https://github.com/ollama/ollama). By default, it's running on http://localhost:11434.    

2. Install Chroma

    Please refer to [https://docs.trychroma.com/getting-started](https://docs.trychroma.com/getting-started) for Chroma installation.

    We recommend you run it in a docker container:

    ```bash
    #https://hub.docker.com/r/chromadb/chroma/tags

    docker pull chromadb/chroma
    docker run -d -p 8000:8000 chromadb/chroma
    ```
    Now, ChromaDB is running on http://localhost:8000

3. ChatOllama Setup

    Now, we can complete the necessary setup to run ChatOllama.

    3.1 Copy the `.env.example` file to `.env` file:

    ```bash
    cp .env.example .env
    ```

    3.2 Make sure to install the dependencies:

    ```bash
    pnpm install
    ```

    3.3 Run a migration to create your database tables with Prisma Migrate

    ```bash
    pnpm prisma-migrate
    ```

4. Launch Development Server

    > Make sure both __[Ollama Server](#ollama-server)__ and __[ChromaDB](#install-chromadb-and-startup)__ are running.

    Start the development server on `http://localhost:3000`:

    ```bash
    pnpm dev
    ```

### Use with Docker

This is the easist way to use `ChatOllama`.

The only thing you need is a copy of [docker-compose.yaml](./docker-compose.yaml). Please download it and execute the command below to launch `ChatOllama`.

```shell
$ docker compose up
```

As `ChatOllama` is running within a docker container, you should set Ollama server to `http://host.docker.internal:11434` in the Settings section, assuming your Ollama server is running locally with default port.

Make sure you initialize the SQLite database as below if you are launching the dockerized `ChatOllama` for the first time:

```shell
$ docker compose exec chatollama npx prisma migrate dev
```
#### Prerequisites for knowledge bases
When using KnowledgeBases, we need a valid embedding model in place. It can be one of the models downloaded by Ollama or from 3rd party service provider for example, OpenAI.

**Ollama Managed Embedding Model**

We recommend you download `nomic-embed-text` model for embedding purpose.

You can do so on Models page http://localhost:3000/models, or via CLI as below if you are using Docker.

```shell
# In the folder of docker-compose.yaml

$ docker compose exec ollama ollama pull nomic-embed-text:latest
```

**OpenAI Embedding Model**

If you prefer to use OpenAI, please make sure you set a valid OpenAI API Key in Settings, and fill with one of the OpenAI embedding models listed below:

- `text-embedding-3-large`
- `text-embedding-3-small`
- `text-embedding-ada-002`

#### Data Storage with Docker Containers

There are 2 types of data storage, vector data and relational data. See the summary below and for more details, please refer to [docker-compose.yaml](./docker-compose.yaml) for the settings.

##### Vector data

With `docker-compose.yaml`, a dockerized Chroma database is run side by side with `ChatOllama`. The data is persisted in a docker volume.

##### Relational data

The relational data including knowledge base records and their associated files are stored in a SQLite database file persisted and mounted from `~/.chatollama/chatollama.sqlite`.

#### Proxy

We have provided a proxy configuration feature. For specific usage, please click [here](docs/proxy-usage.md).

## Developers Guide

As ChatOllama is still under active development, features, interfaces and database schema may be changed. Please follow the instructions below in your every `git pull` to make sure your dependencies and database schema are always in sync.

1. Install the latest dependencies
    - `pnpm install`
2. Prisma migrate
    - `pnpm prisma-migrate`
