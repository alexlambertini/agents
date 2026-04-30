#!/usr/bin/env node
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const diff = require("diff");

// --------------------
// CONFIGURATION (Multi-LLM Support)
// --------------------
const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {}
  
  // Default config
  return {
    "llm_provider": "ollama",
    "ollama": {
      "base_url": "http://localhost:11434",
      "model": "agent-os"
    },
    "openai": {
      "api_key": "",
      "base_url": "https://api.openai.com/v1",
      "model": "gpt-4"
    },
    "ml_service_url": "http://localhost:8000"
  };
}

const CONFIG = loadConfig();

// --------------------
// CLI ARGS
// --------------------
const task = process.argv[2];
let projectPath = process.argv[3];

if (!projectPath) {
  projectPath = process.cwd();
}

projectPath = path.resolve(projectPath);

// CORREÇÃO: Se projectPath terminar com 'go', subir um nível
// (caso usuário rode de dentro da pasta go/)
if (projectPath.endsWith(path.sep + 'go')) {
  projectPath = path.dirname(projectPath);
}

// --------------------
// MODEL
// --------------------
const MODEL = "agent-os";

// --------------------
// MEMÓRIA DE APRENDIZADO (Few-Shot Learning)
// --------------------
const MEMORY_FILE = path.join(__dirname, 'agent-memory.json');

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { examples: [], failures: [] };
}

function saveMemory(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

let agentMemory = loadMemory();

function addSuccessExample(task, actions) {
  agentMemory.examples.push({
    task: task,
    actions: actions.slice(0, 5), // Primeiros 5 passos
    timestamp: Date.now()
  });
  // Manter apenas últimos 10 exemplos
  if (agentMemory.examples.length > 10) {
    agentMemory.examples = agentMemory.examples.slice(-10);
  }
  saveMemory(agentMemory);
}

function addFailurePattern(task, error, action) {
  agentMemory.failures.push({
    task: task,
    error: error,
    action: action,
    timestamp: Date.now()
  });
  if (agentMemory.failures.length > 20) {
    agentMemory.failures = agentMemory.failures.slice(-20);
  }
  saveMemory(agentMemory);
}

function getFewShotExamples() {
  if (agentMemory.examples.length === 0) {
    return "";
  }
  
  let examples = "\n\nEXEMPLOS DE SUCESSO ANTERIORES (APRENDA COM ELES):\n";
  for (const ex of agentMemory.examples.slice(-3)) { // Últimos 3
    examples += `\nTarefa: ${ex.task}\n`;
    examples += "Ações que funcionaram:\n";
    for (const action of ex.actions) {
      examples += `  ${JSON.stringify(action)}\n`;
    }
  }
  return examples;
}

function getFailurePatterns() {
  if (agentMemory.failures.length === 0) {
    return "";
  }
  
  let failures = "\n\nERROS COMETIDOS ANTERIORMENTE (EVITE REPETIR):\n";
  const recentFailures = agentMemory.failures.slice(-5); // Últimos 5
  for (const f of recentFailures) {
    failures += `- Erro: ${f.error}\n`;
    failures += `  Ação que falhou: ${JSON.stringify(f.action)}\n`;
  }
  return failures;
}

// --------------------
// ML SERVICE INTEGRATION
// --------------------
const ML_SERVICE_URL = CONFIG.ml_service_url || 'http://localhost:8000';

let actionHistory = [];

async function callMLService(endpoint, data) {
  try {
    const response = await axios.post(`${ML_SERVICE_URL}/${endpoint}`, data, {
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    console.log(`⚠️ ML Service offline: ${error.message}`);
    return null;
  }
}

async function analyzeErrorWithML(error, task, lastAction, filePath) {
  const mlResult = await callMLService('analyze-error', {
    error: error,
    task: task,
    last_action: lastAction,
    file_path: filePath,
    language: 'go'
  });
  
  if (mlResult && mlResult.suggestion && mlResult.suggestion.confidence > 0.6) {
    console.log(`🧠 ML Sugestion (${(mlResult.suggestion.confidence * 100).toFixed(0)}% confidence): ${mlResult.suggestion.recommended_action}`);
    console.log(`📊 Error type: ${mlResult.error_type}`);
    
    if (mlResult.similar_past_errors && mlResult.similar_past_errors.length > 0) {
      console.log(`🔍 Similar past errors: ${mlResult.similar_past_errors.length} found`);
    }
    
    return mlResult.suggestion;
  }
  
  return null;
}

async function reportSuccessToML(task, actions) {
  await callMLService('learn-success', {
    task: task,
    actions: actions,
    final_state: { status: 'completed' }
  });
}

async function reportFailureToML(error, action, task) {
  await callMLService('learn-failure', {
    error: error,
    action: action,
    task: task
  });
}

// --------------------
// STATE DE CONTROLE (POLICY LAYER)
// --------------------
let patchFailuresByFile = {};
let fallbackUsedByFile = {};
let consecutiveFailures = 0;
let lastAction = null;
let actionRepeatCount = 0;

// --------------------
// VALIDAÇÃO DE SCHEMA (OBRIGATÓRIO)
// --------------------
function validate(action) {
  if (!action || !action.name) {
    throw new Error("Ação inválida: sem nome");
  }

  const validTools = [
    "write_file",
    "read_file",
    "run_cmd",
    "apply_patch",
    "done"
  ];

  if (!validTools.includes(action.name)) {
    throw new Error(`Tool não permitida: ${action.name}`);
  }

  return action;
}

// --------------------
// NORMALIZAÇÃO OBRIGATÓRIA
// --------------------
function normalize(action) {
  if (!action || !action.arguments) {
    return action;
  }

  if (action.arguments.path && !action.arguments.file_path) {
    action.arguments.file_path = action.arguments.path;
  }

  if (action.name === "write_file") {
    return {
      name: "write_file",
      arguments: {
        file_path: action.arguments.file_path,
        content: action.arguments.content || ""
      }
    };
  }

  if (action.name === "read_file") {
    return {
      name: "read_file",
      arguments: {
        file_path: action.arguments.file_path
      }
    };
  }

  if (action.name === "apply_patch") {
    return {
      name: "apply_patch",
      arguments: {
        file_path: action.arguments.file_path,
        diff: action.arguments.diff || ""
      }
    };
  }

  return action;
}

// --------------------
// PARSER RESILIENTE
// --------------------
function extractJSON(text) {
  text = text.replace(/```json|```/g, "");
  
  // Normalizar variações (action vs name)
  text = text.replace(/"action"\s*:/g, '"name":');
  text = text.replace(/"tool"\s*:/g, '"name":');
  
  const jsonRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  const matches = text.match(jsonRegex);
  
  if (matches) {
    for (let i = matches.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(matches[i]);
        if (parsed.name && parsed.arguments !== undefined) {
          return parsed;
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("JSON inválido");
  
  return JSON.parse(text.slice(start, end + 1));
}

// --------------------
// VALIDAÇÃO DE PATH
// --------------------
function resolvePath(filePath, basePath) {
  let resolved;

  if (path.isAbsolute(filePath)) {
    resolved = path.resolve(filePath);
  } else {
    // CORREÇÃO DEFINITIVA: remover pasta do projeto do início do path
    let normalizedPath = filePath;
    
    const projectFolder = path.basename(basePath);
    
    // Se path começa com "go/" ou nome da pasta do projeto, remover
    if (normalizedPath.startsWith(projectFolder + '/')) {
      normalizedPath = normalizedPath.substring(projectFolder.length + 1);
    }
    
    // Se ainda houver duplicação (ex: go/go/main.go), corrigir
    const duplicatePattern = new RegExp(`^${projectFolder}/${projectFolder}/`);
    if (duplicatePattern.test(normalizedPath)) {
      normalizedPath = normalizedPath.replace(duplicatePattern, `${projectFolder}/`);
    }
    
    resolved = path.join(basePath, normalizedPath);
  }

  if (!resolved.startsWith(basePath)) {
    throw new Error("Path fora do projeto não permitido");
  }

  return resolved;
}

// --------------------
// TOOLS PURAS (EXECUTOR)
// --------------------
function write_file(args, basePath) {
  if (!args || !args.file_path) {
    return "ERROR: file_path ausente";
  }

  const filePath = resolvePath(args.file_path, basePath);
  const content = args.content || "";

  const exists = fs.existsSync(filePath);
  let oldContent = "";

  if (exists) {
    oldContent = fs.readFileSync(filePath, "utf-8");
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);

  if (exists) {
    const changes = diff.createPatch(filePath, oldContent, content);
    console.log("\n--- DIFF (write_file) ---");
    console.log(changes);
    console.log("--- END DIFF ---\n");
  }

  return `arquivo ${exists ? 'atualizado' : 'criado'}: ${filePath}`;
}

function read_file(args, basePath) {
  if (!args || !args.file_path) {
    return "ERROR: file_path ausente";
  }

  const filePath = resolvePath(args.file_path, basePath);

  return fs.readFileSync(filePath, "utf-8");
}

function run_cmd(args) {
  if (!args || !args.command) {
    return "ERROR: command ausente";
  }

  try {
    return execSync(args.command, {
      cwd: projectPath,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024
    }).toString();
  } catch (e) {
    return e.toString();
  }
}

// --------------------
// PATCH ENGINE (EXECUTOR)
// --------------------
function apply_patch(args, basePath) {
  if (!args || !args.file_path) {
    return "ERROR: file_path ausente";
  }

  if (!args.diff) {
    return "ERROR: diff ausente";
  }

  // Validação de patch
  if (!validatePatch(args.diff)) {
    return "ERROR: diff inválido - cabeçalho @@ ausente";
  }

  const filePath = resolvePath(args.file_path, basePath);

  if (!fs.existsSync(filePath)) {
    return `ERROR: arquivo não existe: ${filePath}`;
  }

  const oldContent = fs.readFileSync(filePath, "utf-8");

  let newContent;
  try {
    const patchResult = diff.applyPatch(oldContent, args.diff);
    if (patchResult === false) {
      return "ERROR: falha ao aplicar patch - diff inválido";
    }
    newContent = patchResult;
  } catch (e) {
    return `ERROR: erro no patch: ${e.message}`;
  }

  const changes = diff.createPatch(filePath, oldContent, newContent);
  console.log("\n--- DIFF (apply_patch) ---");
  console.log(changes);
  console.log("--- END DIFF ---\n");

  fs.writeFileSync(filePath, newContent);

  return `patch aplicado: ${filePath}`;
}

// --------------------
// VALIDAÇÃO DE PATCH
// --------------------
function validatePatch(diffText) {
  if (!diffText || typeof diffText !== "string") return false;
  if (!diffText.includes("@@")) return false;
  return true;
}

// --------------------
// CONTROLE DE FALHAS
// --------------------
function registerPatchFailure(file) {
  patchFailuresByFile[file] = (patchFailuresByFile[file] || 0) + 1;
  return patchFailuresByFile[file];
}

// --------------------
// POLICY LAYER (PLANNER)
// --------------------
function selectTool(action) {
  const filePath = action.arguments?.file_path;
  if (!filePath) return action.name;

  // REGRA 1: proteção contra alternância infinita
  if (fallbackUsedByFile[filePath]) {
    return "write_file";
  }

  // REGRA 2: fallback por falha (patch → write_file)
  const failures = patchFailuresByFile[filePath] || 0;
  if (failures >= 2 && action.name === "apply_patch") {
    fallbackUsedByFile[filePath] = true;
    return "write_file";
  }

  // REGRA 3: padrão seguro
  return action.name;
}

// --------------------
// EXECUTOR (WRAPPER)
// --------------------
function executeTool(toolName, normalized) {
  switch (toolName) {
    case "write_file":
      return write_file(normalized.arguments, projectPath);
    case "read_file":
      return read_file(normalized.arguments, projectPath);
    case "run_cmd":
      return run_cmd(normalized.arguments);
    case "apply_patch":
      return apply_patch(normalized.arguments, projectPath);
    case "done":
      return "DONE";
    default:
      return "tool inválida";
  }
}

// --------------------
// EXECUTOR ROBUSTO (ORQUESTRADOR)
// --------------------
async function execute(action) {
  try {
    const validated = validate(action);
    const normalized = normalize(validated);

    // POLÍTICA HÍBRIDA: ML decide se confiança alta
    const mlSuggestion = await analyzeErrorWithML(
      "", // error será preenchido após execução se falhar
      task,
      { name: action.name, arguments: action.arguments },
      action.arguments?.file_path
    );

    let selectedTool = selectTool(normalized);

    // Se ML tem sugestão com alta confiança, sobrepor
    if (mlSuggestion && mlSuggestion.confidence > 0.7) {
      selectedTool = mlSuggestion.recommended_action;
      console.log(`🎯 ML override: ${normalized.name} → ${selectedTool}`);
    }

    // Se houve mudança de tool, converter arguments se necessário
    if (selectedTool !== normalized.name && selectedTool === "write_file" && normalized.name === "apply_patch") {
      const filePath = resolvePath(normalized.arguments.file_path, projectPath);
      if (fs.existsSync(filePath)) {
        const oldContent = fs.readFileSync(filePath, "utf-8");
        const patchResult = diff.applyPatch(oldContent, normalized.arguments.diff);
        if (patchResult !== false) {
          normalized.arguments.content = patchResult;
          delete normalized.arguments.diff;
        }
      }
    }

    normalized.name = selectedTool;

    // VALIDAÇÃO PRÉVIA: detectar erros óbvios antes de escrever
    if (normalized.name === "write_file" && normalized.arguments?.file_path) {
      const fp = normalized.arguments.file_path;
      const content = normalized.arguments.content || "";
      
      // Corrigir paths duplicados (ex: go/go/main.go)
      if (fp.includes('go/go/')) {
        normalized.arguments.file_path = fp.replace('go/go/', 'go/');
        context += `\nCorrigido path duplicado: ${fp} → ${normalized.arguments.file_path}`;
      }
      
      // Bloquear arquivos sem extensão ou com nome proibido
      const fileName = path.basename(fp);
      if (!fp.endsWith('.go') && !fp.endsWith('.mod') && !fp.endsWith('.sum')) {
        if (!fileName.includes('.')) {
          return "ERROR: arquivo sem extensão detectado. Use 'main.go' para código Go, não 'nome' ou sem extensão.";
        }
      }
      
      // Bloquear nomes proibidos
      if (fileName === 'nome' || fileName === 'nome.exe' || fileName === 'a.out') {
        return "ERROR: nome de arquivo inválido. Use 'main.go' para código Go principal.";
      }
      
      // Erros óbvios de sintaxe Go
      if (fp.endsWith('.go')) {
        if (content.includes('http.HandleFunc=') || content.includes('http.ListenAndServe"')) {
          return "ERROR: sintaxe Go inválida detectada. Use: http.HandleFunc(\"/path\", handler) e http.ListenAndServe(\":port\", nil) com parênteses.";
        }
      }
      
      // go.mod com versão inválida ou módulo errado
      if (fp.endsWith('go.mod')) {
        if (!content.includes('go 1.2') && !content.includes('go 1.1')) {
          return "ERROR: go.mod deve ter versão Go válida (ex: 'go 1.21'). Use write_file para corrigir.";
        }
        if (content.includes('module nome')) {
          return "ERROR: go.mod não deve ter 'module nome'. Use o nome do projeto (ex: 'module teste').";
        }
      }
    }

    const result = executeTool(selectedTool, normalized);

    // Registrar ação no histórico para ML
    actionHistory.push({
      name: action.name,
      arguments: action.arguments,
      result: result,
      timestamp: Date.now()
    });

    return result;
  } catch (e) {
    if (action.name === "apply_patch") {
      const file = action.arguments?.file_path;
      if (file) {
        registerPatchFailure(file);
      }
    }
    return `ERROR: ${e.message}`;
  }
}

// --------------------
// CALL MODEL (Multi-LLM Support)
// --------------------
async function callModel(prompt) {
  const provider = CONFIG.llm_provider || 'ollama';
  
  if (provider === 'openai') {
    const apiKey = CONFIG.openai.api_key;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured in config.json');
    }
    
    const res = await axios.post(
      `${CONFIG.openai.base_url}/chat/completions`,
      {
        model: CONFIG.openai.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return res.data.choices[0].message.content;
  }
  
  // Default: Ollama
  const baseUrl = CONFIG.ollama.base_url || 'http://localhost:11434';
  const res = await axios.post(`${baseUrl}/api/generate`, {
    model: CONFIG.ollama.model || 'agent-os',
    prompt,
    stream: false
  });

  return res.data.response;
}

// --------------------
// AGENTE
// --------------------
async function run(task) {
  let context = `Você é um agente de engenharia de software.

  OBJETIVO:
${task}

  ${getFewShotExamples()}
  ${getFailurePatterns()}

  REGRAS ESPECÍFICAS PARA GO + SQLITE:
  1. go.mod DEVE usar module "teste" (NUNCA "github.com/yourusername/yourproject")
  2. SEMPRE execute "cd go && go mod tidy" após criar go.mod
  3. Para SQLite: importe "database/sql" e _ "github.com/mattn/go-sqlite3"
  4. Crie handlers SEPARADOS para cada CRUD:
     - GET /todos → lista todos
     - GET /todo/{id} → busca um
     - POST /todos → cria novo
     - PUT /todo/{id} → atualiza
     - DELETE /todo/{id} → remove
  5. Estrutura do TODO: {id, title, done bool}
  6. Inicialize db em init(): db, _ = sql.Open("sqlite3", "./todos.db")
  7. Crie tabela se não existir: CREATE TABLE IF NOT EXISTS todos (...)
  8. NUNCA use ":memory:" em produção - use arquivo .db
  9. main.go deve ter imports completos e compilar de primeira

  INSTRUÇÕES PASSO-A-PASSO:
 1. PRIMEIRO: criar go.mod com "go mod init teste" via run_cmd
 2. CRIAR main.go com SQLite e CRUD completo (veja exemplo abaixo)
 3. Executar "cd go && go mod tidy" para baixar dependências
 4. CRIAR interface web (se solicitado): "go/static/index.html" e "go/static/app.js"
 5. Compilar: run_cmd com "cd go && go mod tidy && go build -o app ."
 6. Se erro de compilação, usar write_file para corrigir
 7. TESTAR: run_cmd com "curl localhost:8080/todos"
 8. done SÓ QUANDO:
    - main.go compilar sem erros
    - Endpoints CRUD responderem corretamente
    - (Opcional) Interface web criada e funcionando

EXEMPLO DE CRUD GO + SQLITE (main.go):
package main

import (
    "database/sql"
    _ "github.com/mattn/go-sqlite3"
    "net/http"
    "encoding/json"
)

var db *sql.DB

func init() {
    var err error
    db, err = sql.Open("sqlite3", "./todos.db")
    if err != nil { panic(err) }
    _, err = db.Exec("CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, done BOOLEAN)")
    if err != nil { panic(err) }
}

func todosHandler(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case "GET":
        rows, err := db.Query("SELECT id, title, done FROM todos")
        if err != nil { http.Error(w, err.Error(), 500); return }
        defer rows.Close()
        var todos []map[string]interface{}
        for rows.Next() {
            var id int; var title string; var done bool
            rows.Scan(&id, &title, &done)
            todos = append(todos, map[string]interface{}{"id": id, "title": title, "done": done})
        }
        json.NewEncoder(w).Encode(todos)
    case "POST":
        var t struct { Title string; Done bool }
        json.NewDecoder(r.Body).Decode(&t)
        _, err := db.Exec("INSERT INTO todos (title, done) VALUES (?, ?)", t.Title, t.Done)
        if err != nil { http.Error(w, err.Error(), 500); return }
        w.Write([]byte("created"))
    }
}

func main() {
    fs := http.FileServer(http.Dir("./static"))
    http.Handle("/", fs)
    http.HandleFunc("/todos", todosHandler)
    http.ListenAndServe(":8080", nil)
}

REGRAS DE CAMINHOS (PATH):
- Projeto está em: ${projectPath}
- Arquivos Go: "go/main.go" (NUNCA "go/go/main.go")
- go.mod: "go/go.mod" (NUNCA "go/go/go.mod")
- SEMPRE usar paths relativos ao projeto, sem duplicar pastas
- Se projeto já existe, NÃO recriar estrutura base

EXEMPLO DE FLUXO PARA ADICIONAR CRUD:
1. read_file "go/main.go" → ver código atual
2. write_file "go/main.go" → escrever código COM NOVOS ENDPOINTS
3. go build → compilar
4. done apenas quando tudo funcionar

O QUE É "INTERFACE WEB" (OBRIGATÓRIO):
- Criar pasta "go/static/"
- Criar "go/static/index.html" → interface HTML com botões para GET/POST/PUT/DELETE
- Criar "go/static/app.js" → código JavaScript para fazer fetch() aos endpoints
- MODIFICAR main.go → adicionar http.FileServer para servir arquivos estáticos
- TESTAR: acessar localhost:8080/ no navegador

EXEMPLO DE INTERFACE WEB (obrigatório criar):
go/static/index.html:
  <html><body>
    <h1>API CRUD</h1>
    <button onclick="testAPI('GET')">GET</button>
    <button onclick="testAPI('POST')">POST</button>
    <button onclick="testAPI('PUT')">PUT</button>
    <button onclick="testAPI('DELETE')">DELETE</button>
    <div id="result"></div>
    <script src="app.js"></script>
  </body></html>

go/static/app.js:
  function testAPI(method) {
    // Use a rota do recurso (plural): /carros, /produtos, /todos, etc.
    fetch('/recursos', {method: method})
      .then(r => r.text())
      .then(d => document.getElementById('result').innerText = d);
  }

main.go DEVE ter:
  fs := http.FileServer(http.Dir("./static"))
  http.Handle("/", fs)
  ou
  http.Handle("/", http.FileServer(http.Dir("static")))

  REGRAS DE NOMES:
  - Arquivo principal SEMPRE se chama "main.go"
  - NUNCA criar arquivo com nome "nome" ou sem extensão
  - go.mod: módulo deve ser "teste" (NÃO "github.com/yourusername/yourproject")
  - Compilação: use sempre "cd go && go mod tidy && go build -o app ."

REGRAS DE CÓDIGO:
- Handler: http.HandleFunc("/test", handler) ← parênteses obrigatórios
- ListenAndServe: http.ListenAndServe(":8080", nil) ← parênteses obrigatórios
- Imports devem estar entre aspas: import "net/http"
- Sempre teste compilação com "go build"

REGRAS CRÍTICAS PARA GO + SQL:
- db.Exec() RETORNA 2 VALORES: (sql.Result, error)
- CORRETO: _, err = db.Exec("INSERT ...")
- ERRADO: _ = db.Exec("INSERT ...") ← CAUSA ERRO DE COMPILAÇÃO
- ERRADO: db.Exec("INSERT ...") ← CAUSA ERRO DE COMPILAÇÃO
- SEMPRE: _, err = db.Exec(...) ou resultado, err := db.Exec(...)
- db.Query() TAMBÉM retorna (rows, error): rows, err := db.Query(...)
- db.QueryRow() retorna apenas *Row: row := db.QueryRow(...)

PROJETO PATH:
${projectPath}

TOOLS (USE APENAS ESTE FORMATO EXATO):

{
  "name": "write_file",
  "arguments": {
    "file_path": "string",
    "content": "string"
  }
}

{
  "name": "read_file",
  "arguments": {
    "file_path": "string"
  }
}

{
  "name": "run_cmd",
  "arguments": {
    "command": "string"
  }
}

{
  "name": "apply_patch",
  "arguments": {
    "file_path": "string",
    "diff": "string (unified diff format)"
  }
}

{
  "name": "done",
  "arguments": {}
}

REGRAS OBRIGATÓRIAS:
- Responder SOMENTE JSON válido
- Nunca usar "path", apenas "file_path"
- Nunca escrever texto fora do JSON
- Nunca usar markdown
- Use apply_patch apenas para mudanças pequenas em arquivos existentes
- Após erro de patch, NÃO repetir tentativa
- Se houver erro de build, usar write_file
- Nunca insistir em tool falhando
- Sempre adaptar estratégia após erro
- Para criar arquivos novos, use write_file

EXEMPLOS DE CÓDIGO CORRETOS:

Go (HTTP Server):
package main

import "net/http"

func handler(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("Hello, World!"))
}

func main() {
    http.HandleFunc("/test", handler)
    http.ListenAndServe(":8080", nil)
}

Go (sintaxe crítica):
- HandleFunc: http.HandleFunc("/path", handler) ← parênteses obrigatórios
- ListenAndServe: http.ListenAndServe(":port", nil) ← parênteses obrigatórios
- Sempre verifique parênteses e vírgulas antes de gerar código
`;

  for (let i = 0; i < 15; i++) {
    console.log(`\n--- STEP ${i} ---`);

    const output = await callModel(context);
    console.log("MODEL:", output);

    let action;
    try {
      action = extractJSON(output);
    } catch (e) {
      context += `\nJSON inválido: ${e.message}. Corrija e responda apenas JSON válido.`;
      consecutiveFailures++;
      continue;
    }

    const result = await execute(action);
    console.log("RESULT:", result);

    // STUCK DETECTION: detectar ação repetitiva
    const actionKey = JSON.stringify({name: action.name, file: action.arguments?.file_path, content: action.arguments?.content?.slice(0,50) });
    if (actionKey === lastAction) {
      actionRepeatCount++;
    } else {
      actionRepeatCount = 0;
    }
    lastAction = actionKey;

    if (actionRepeatCount >= 2) {
      context += `
ALERTA: Você está repetindo a mesma ação (${action.name}) com os mesmos argumentos!
OBRIGATÓRIO:
- Mudar estratégia imediatamente
- Avançar para o próximo passo da tarefa
- Se já criou go.mod, agora crie main.go
`;
      actionRepeatCount = 0;
    }

    // Controle de falhas
    if (result.startsWith("ERROR:")) {
      consecutiveFailures++;

      // Reportar falha para ML
      await reportFailureToML(result, action, task);

      // Tentar usar ML para corrigir
      const mlAdvice = await analyzeErrorWithML(result, task, action, action.arguments?.file_path);
      if (mlAdvice && mlAdvice.recommended_action !== action.name) {
        context += `\n🧠 ML SUGGESTION: Tente usar ${mlAdvice.recommended_action} em vez de ${action.name}`;
      }

      if (action.name === "apply_patch") {
        const file = action.arguments?.file_path;
        if (file) {
          const failures = registerPatchFailure(file);
          if (failures >= 2) {
            context += `
FALHA CRÍTICA DE PATCH DETECTADA em ${file}.

OBRIGATÓRIO:
- parar uso de apply_patch para este arquivo
- usar write_file para reescrever o arquivo inteiro
`;
          }
        }
      }

      // Truncar contexto após 3 falhas
      if (consecutiveFailures >= 3) {
        const lines = context.split('\n');
        context = lines.slice(0, 20).join('\n') + '\n\n[...contexto truncado...]\n\n' +
                  `OBJETIVO: ${task}\n\n` +
                  `ÚLTIMO ERRO: ${result}\n` +
                  `ÚLTIMA TENTATIVA: ${JSON.stringify(action)}`;
        consecutiveFailures = 0;
      }
    } else {
      consecutiveFailures = 0;
    }

    // BLOQUEIO DE DONE PRECOCE: verificar se tarefa foi concluída
    if (action.name === "done") {
      // Verificar se arquivos obrigatórios foram criados
      const requiredFiles = [];
      if (task.toLowerCase().includes('interface') || task.toLowerCase().includes('web')) {
        requiredFiles.push('go/static/index.html', 'go/static/app.js');
      }
      
      let missingFiles = [];
      for (const f of requiredFiles) {
        try {
          resolvePath(f, projectPath);
          if (!fs.existsSync(path.join(projectPath, f))) {
            missingFiles.push(f);
          }
        } catch (e) {
          missingFiles.push(f);
        }
      }
      
      if (missingFiles.length > 0) {
        context += `
ERRO: Você marcou "done" mas a tarefa NÃO está completa!
Arquivos faltando: ${missingFiles.join(', ')}
OBRIGATÓRIO: continuar trabalhando até criar todos os arquivos.
`;
        continue;
      }
    }

    if (action.name === "done") {
      // APRENDIZADO: registrar sucesso
      if (task && !result.startsWith("ERROR:")) {
        // Coletar ações bem-sucedidas
        const successfulActions = context.match(/AÇÃO: ({.*?})/g)?.slice(-5) || [];
        addSuccessExample(task, successfulActions);
        
        // Reportar sucesso para ML
        await reportSuccessToML(task, actionHistory);
      }
      break;
    }

    // APRENDIZADO: registrar falha se houver erro
    if (result.startsWith("ERROR:")) {
      addFailurePattern(task, result, action);
    }

    context += `
AÇÃO: ${JSON.stringify(action)}
RESULTADO: ${result}
`;
  }
}

// --------------------
// HELP TEXT
// --------------------
const HELP_TEXT = `Uso:
  ai "tarefa" [caminho_do_projeto]
  ai help | -h | --help → mostra esta ajuda

Pré-requisitos:
  - Ollama rodando em localhost:11434
  - Modelo "agent-os" disponível

Tools (JSON gerado pelo modelo):
  - write_file: file_path, content → cria/atualiza arquivos (exibe diff real)
  - read_file: file_path → lê arquivos
  - run_cmd: command → executa comandos no projeto (cwd restrito)
  - apply_patch: file_path, diff → aplica patches unificados (validação @@)
  - done: {} → encerra o agente

Funcionalidades:
  - Validação de schema de tools (whitelist restrita)
  - Normalização automática path ↔ file_path
  - Restrição de paths ao projeto (bloqueio de paths externos)
  - Policy Layer (Planner + Executor separados)
  - Controle de falhas por arquivo (patchFailuresByFile)
  - Proteção contra alternância infinita (fallbackUsedByFile)
  - Fallback automático: apply_patch → write_file após 2 falhas
  - Validação de formato de patch (cabeçalho @@ obrigatório)
  - Truncamento de contexto após 3 falhas consecutivas
  - Exibição de diff real antes/depois de alterações
  - Loop de até 15 iterações com parada em "done"`;

// --------------------
// RUN
// --------------------
if (!task || ["help", "-h", "--help"].includes(task)) {
  console.log(HELP_TEXT);
  process.exit(0);
}

run(task);
