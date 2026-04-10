# Foundry

A modern agent-based development platform that combines AI capabilities with collaborative tooling.

## Overview

Foundry is a full-stack application consisting of a React-based web frontend and a Node.js/Express backend service. It provides a platform for AI agents to collaborate on software development tasks with built-in sandboxing capabilities.

## Architecture

- **Frontend (`web/`)**: React + TypeScript + Vite application with Tailwind CSS
- **Backend (`service/`)**: Node.js + Express + TypeScript service with SQLite database
- **Documentation (`docs/`)**: System design specifications and data models

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd foundry
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the development servers:

Backend service:
```bash
cd service
npm run dev
```

Frontend (in another terminal):
```bash
cd web  
npm run dev
```

## Development

### Project Structure
```
foundry/
├── web/           # React frontend application
├── service/       # Express backend service  
├── docs/          # Documentation and specifications
└── export/        # Data export files
```

### Key Technologies
- **Frontend**: React, TypeScript, Vite, Tailwind CSS, React Router
- **Backend**: Node.js, Express, TypeScript, SQLite, Drizzle ORM
- **AI Integration**: Anthropic Claude, OpenAI APIs
- **Development**: Vitest for testing, TSX for development

### Scripts
- `npm run dev` - Start development servers
- `npm run build` - Build for production
- `npm run test` - Run tests
- `npm run db:push` - Push database schema changes

## Documentation

See the `docs/` directory for detailed system design specifications:
- `system-design.md` - Core architecture and design principles
- `data-model.md` - Database schema and data structures

## Contributing

This is an internal project. Please refer to the system design documentation for development guidelines and architectural decisions.

## License

Private - Internal use only