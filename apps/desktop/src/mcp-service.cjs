/**
 * @file mcp-service.cjs
 * @description Local MCP (Model Context Protocol) Tool Host & Sandbox Service for Union Bot Phase P5 (P5-008, P5-009).
 *
 * Implements:
 * - Local MCP tool registration and capability negotiation.
 * - Safe calculator tool (pure AST/token evaluation without eval/Function).
 * - CAS artifact inspector tool.
 * - Workspace summary tool.
 * - Zero remote egress, zero secret leakage.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Safe mathematical expression evaluator without eval() or Function().
 * Supports +, -, *, /, %, ^, parentheses, negative numbers, decimals.
 */
function safeEvaluateMath(expr) {
  if (typeof expr !== 'string') {
    throw new Error('Expression must be a string');
  }

  // Tokenize
  const cleaned = expr.replace(/\s+/g, '');
  if (!/^[\d+\-*/%^().eE]+$/.test(cleaned)) {
    throw new Error('Expression contains disallowed characters');
  }

  let index = 0;

  function peek() {
    return cleaned[index];
  }

  function get() {
    return cleaned[index++];
  }

  function parseNumber() {
    let start = index;
    if (peek() === '-') get();
    while (index < cleaned.length && /[\d.]/.test(peek())) {
      get();
    }
    if (index === start || (index === start + 1 && cleaned[start] === '-')) {
      throw new Error(`Unexpected token at position ${index}`);
    }
    return parseFloat(cleaned.slice(start, index));
  }

  function parseFactor() {
    if (peek() === '(') {
      get(); // consume '('
      const val = parseExpression();
      if (get() !== ')') throw new Error("Expected closing ')'");
      return val;
    }
    return parseNumber();
  }

  function parsePower() {
    let base = parseFactor();
    while (peek() === '^') {
      get();
      const exponent = parsePower();
      base = Math.pow(base, exponent);
    }
    return base;
  }

  function parseTerm() {
    let left = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = get();
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left /= right;
      } else if (op === '%') {
        left %= right;
      }
    }
    return left;
  }

  function parseExpression() {
    let left = parseTerm();
    while (peek() === '+' || (peek() === '-' && index > 0 && !/[+\-*/%^(]/.test(cleaned[index - 1]))) {
      const op = get();
      const right = parseTerm();
      if (op === '+') left += right;
      else if (op === '-') left -= right;
    }
    return left;
  }

  const result = parseExpression();
  if (index < cleaned.length) {
    throw new Error(`Unexpected token '${cleaned[index]}' at position ${index}`);
  }
  return result;
}

class MCPService {
  constructor(casStorePath, workspaceRoot) {
    this.casStorePath = path.resolve(casStorePath);
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.protocolVersion = '2024-11-05';
    this.serverInfo = {
      name: 'union-bot-local-mcp-host',
      version: '1.0.0',
    };
  }

  /**
   * Negotiates capabilities with an MCP client (P5-008).
   */
  negotiateCapabilities(clientCapabilities = {}) {
    return {
      protocolVersion: this.protocolVersion,
      serverInfo: this.serverInfo,
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
      },
    };
  }

  /**
   * Lists available local MCP tools (P5-008).
   */
  listTools() {
    return [
      {
        name: 'calculator',
        description: 'Safe zero-cost mathematical calculator for arithmetic, powers, and percentages.',
        inputSchema: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: "Mathematical expression to evaluate (e.g. '128 * 4 + (50 / 2)')",
            },
          },
          required: ['expression'],
        },
      },
      {
        name: 'artifact_inspect',
        description: 'Inspects a content-addressable storage (CAS) artifact by its SHA256 digest.',
        inputSchema: {
          type: 'object',
          properties: {
            sha256: {
              type: 'string',
              description: '64-character hexadecimal SHA256 hash of the artifact',
            },
          },
          required: ['sha256'],
        },
      },
      {
        name: 'workspace_summary',
        description: 'Provides a summary of files and project structure within the active workspace.',
        inputSchema: {
          type: 'object',
          properties: {
            maxDepth: {
              type: 'number',
              description: 'Maximum folder traversal depth (default: 2)',
            },
          },
        },
      },
    ];
  }

  /**
   * Invokes an MCP tool safely (P5-008, P5-009).
   */
  async callTool(toolName, args = {}) {
    switch (toolName) {
      case 'calculator': {
        const { expression } = args || {};
        if (!expression || typeof expression !== 'string') {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Missing or invalid expression argument' }],
          };
        }
        try {
          const value = safeEvaluateMath(expression);
          return {
            isError: false,
            content: [
              {
                type: 'text',
                text: `${expression} = ${value}`,
              },
            ],
            data: { expression, value },
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Calculation error: ${err.message}` }],
          };
        }
      }

      case 'artifact_inspect': {
        const { sha256 } = args || {};
        if (!sha256 || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256.trim())) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Invalid SHA256 format. Must be 64-character hex.' }],
          };
        }
        const cleanSha = sha256.trim().toLowerCase();
        const targetPath = path.resolve(this.casStorePath, cleanSha);
        if (!targetPath.startsWith(this.casStorePath + path.sep)) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'ERR_PATH_TRAVERSAL: Access denied outside CAS store' }],
          };
        }
        if (!fs.existsSync(targetPath)) {
          return {
            isError: false,
            content: [{ type: 'text', text: `Artifact ${cleanSha} not found in CAS store` }],
            data: { sha256: cleanSha, exists: false },
          };
        }
        const stats = fs.statSync(targetPath);
        return {
          isError: false,
          content: [
            {
              type: 'text',
              text: `Artifact ${cleanSha}: ${stats.size} bytes, modified ${stats.mtime.toISOString()}`,
            },
          ],
          data: {
            sha256: cleanSha,
            exists: true,
            sizeBytes: stats.size,
            mtime: stats.mtime.toISOString(),
          },
        };
      }

      case 'workspace_summary': {
        try {
          const entries = fs.readdirSync(this.workspaceRoot, { withFileTypes: true });
          const topLevelFiles = entries.filter(e => !e.isDirectory()).map(e => e.name);
          const topLevelDirs = entries.filter(e => e.isDirectory() && e.name !== '.git' && e.name !== 'node_modules').map(e => e.name);
          return {
            isError: false,
            content: [
              {
                type: 'text',
                text: `Workspace ${path.basename(this.workspaceRoot)}: ${topLevelDirs.length} directories, ${topLevelFiles.length} files`,
              },
            ],
            data: {
              workspaceName: path.basename(this.workspaceRoot),
              directories: topLevelDirs,
              files: topLevelFiles.slice(0, 30),
            },
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to inspect workspace: ${err.message}` }],
          };
        }
      }

      default:
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown MCP tool: ${toolName}` }],
        };
    }
  }
}

module.exports = { MCPService, safeEvaluateMath };
