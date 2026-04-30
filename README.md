# 🚀 Agent OS - Agente de Engenharia de Software Local

Agente CLI autônomo baseado em Node.js + Ollama, capaz de criar projetos completos, corrigir erros e iterar até conclusão da tarefa.

**Estilo:** Mini OpenDevin local com execução real de código.

---

## 📋 Funcionalidades

- ✅ **Policy Layer** (Planner + Executor separados)
- ✅ **Patch Engine** (apply_patch com diffs unificados)
- ✅ **Fallback Inteligente** (apply_patch → write_file após 2 falhas)
- ✅ **Stuck Detection** (detecta repetição de ações)
- ✅ **Machine Learning** (aprendizado via few-shot examples)
- ✅ **Validação Prévia** (detecta erros óbvios antes de escrever)
- ✅ **Controle de Paths** (evita duplicação `go/go/main.go`)
- ✅ **Interface Web** (cria HTML/JS para testar APIs)
- ✅ **Bloqueio de Done Precoce** (verifica se tarefa foi concluída)

---

## 🛠 Pré-requisitos

1. **Node.js** (v18+):
   ```bash
   node --version  # deve ser v18 ou superior
   ```

2. **Ollama** instalado e rodando:
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ollama serve &
   ```

3. **Modelo Qwen2.5 Coder 7B** (ou agent-os):
   ```bash
   ollama pull qwen2.5-coder:7b
   # ou crie seu modelo customizado:
   ollama create agent-os -f Modelfile
   ```

---

## 📦 Instalação

### Opção 1: Instalação Local
```bash
git clone <repo-url> ai-cli
cd ai-cli
npm install
```

### Opção 2: Tornar Global (Recomendado)
```bash
cd ai-cli
npm link
# Agora você pode usar 'ai' de qualquer lugar
```

### Opção 3: Instalação Manual Global
```bash
cd ai-cli
npm install -g .
```

---

## 🚀 Como Usar

### Sintaxe Básica
```bash
ai "tarefa" [caminho_do_projeto]
```

### Exemplos Reais

**1. Criar API Go simples:**
```bash
ai "crie uma pasta go e depois dentro dela monte uma API em go com um endpoint teste" /home/lambertini/teste
```

**2. Adicionar CRUD de telefone:**
```bash
ai "adicione um novo end-point nesse projeto, com crude de telefone, get, dele, push etc" /home/lambertini/teste
```

**3. Criar interface web:**
```bash
ai "preciso de uma interface web, para interagir com o end-point phone" /home/lambertini/teste
```

**4. Projeto do zero (sem path = diretório atual):**
```bash
cd /home/lambertini/meu-projeto
ai "crie uma API RESTful em Go com endpoints para usuários"
```

---

## 🧱 Tools Disponíveis (JSON gerado pelo modelo)

O agente usa **apenas** este formato JSON:

### write_file
```json
{
  "name": "write_file",
  "arguments": {
    "file_path": "go/main.go",
    "content": "package main\n\nimport \"net/http\"\n..."
  }
}
```

### read_file
```json
{
  "name": "read_file",
  "arguments": {
    "file_path": "go/main.go"
  }
}
```

### run_cmd
```json
{
  "name": "run_cmd",
  "arguments": {
    "command": "cd go && go build -o app ."
  }
}
```

### apply_patch (preferencial para mudanças pequenas)
```json
{
  "name": "apply_patch",
  "arguments": {
    "file_path": "go/main.go",
    "diff": "@@ -10,7 +10,7 @@\n-       http.HandleFunc=\"/test\", handler)\n+       http.HandleFunc(\"/test\", handler)\n..."
  }
}
```

### done (encerra o agente)
```json
{
  "name": "done",
  "arguments": {}
}
```

---

## 🧠 Como Funciona (Pipeline)

```
1. Você define a tarefa
   ↓
2. Modelo gera JSON com tool
   ↓
3. POLICY LAYER decide tool (Planner)
   - Se apply_patch falhou 2x → usa write_file
   - Se arquivo não existe → usa write_file
   ↓
4. EXECUTOR executa a tool
   - Valida paths (bloqueia externos)
   - Valida sintaxe Go antes de escrever
   - Exibe diff real no console
   ↓
5. Resultado volta para o modelo
   ↓
6. Loop até "done" ou 15 iterações
```

---

## 🎯 Recursos Avançados

### 1. Machine Learning (Aprendizado)
- Armazena sucessos em `agent-memory.json`
- Injeta few-shot examples no prompt
- Evita repetir erros passados
- Memória persiste entre execuções

### 2. Stuck Detection
- Detecta ações repetitivas (mesmo JSON 2x)
- Força mudança de estratégia
- Evita loops infinitos

### 3. Validação Prévia
- Bloqueia `go.mod` com `module nome`
- Impede arquivos sem extensão (ex: `nome`)
- Detecta erros de sintaxe Go (`http.HandleFunc=`)
- Corrige paths duplicados (`go/go/main.go` → `go/main.go`)

### 4. Bloqueio de Done Precoce
- Verifica se arquivos obrigatórios foram criados
- Para "interface web": exige `static/index.html` e `static/app.js`
- Força continuação até tarefa 100% completa

---

## 📊 Comparação: Antes vs Depois

| Aspecto | Antes | Depois |
|--------|-------|--------|
| Steps para API Go | 12+ (muitos patches falhos) | 3-4 (direto e eficiente) |
| Patch Thrashing | Sim (8 tentativas falhas) | Não (fallback após 2 falhas) |
| Loops Infinitos | Sim | Não (stuck detection) |
| Código Inicial | Com erros de sintaxe | Validação prévia |
| Aprendizado | Não | Sim (few-shot + memória) |

---

## 🔧 Configuração do Modelo (Ollama)

Crie um `Modelfile` para o agente:

```dockerfile
FROM qwen2.5-coder:7b

SYSTEM "Você é um agente de engenharia de software.
Responda SOMENTE JSON válido.
Nunca use 'path', apenas 'file_path'.
Prefira apply_patch para mudanças pequenas."
```

Depois:
```bash
ollama create agent-os -f Modelfile
```

---

## 📂 Estrutura do Projeto

```
ai-cli/
├── index.js           # Agente principal (397 linhas)
├── package.json       # Dependências (axios, diff)
├── agent-memory.json  # Memória de aprendizado (criado automaticamente)
├── README.md         # Este arquivo
└── node_modules/     # Dependências instaladas
```

---

## 🚨 Solução de Problemas

### Erro: "JSON inválido"
- Verifique se o modelo está rodando: `curl http://localhost:11434/api/tags`
- Verifique se o modelo "agent-os" existe: `ollama list`

### Erro: "Path fora do projeto"
- Verifique se o `projectPath` está correto
- Nunca use paths absolutos externos ao projeto

### Erro de compilação Go
- O agente tentará corrigir automaticamente
- Se persistir, verifique se o código Go foi gerado corretamente
- Use `apply_patch` para correções pequenas

### Interface web não carrega
- Verifique se o servidor está rodando: `ps aux | grep app`
- Acesse `http://localhost:8080/` no navegador
- Verifique se a pasta `static/` foi criada

---

## 🎯 Exemplo Completo: API Go + Interface Web

```bash
# 1. Criar API Go
ai "crie uma API em go com endpoint /test" /home/lambertini/api-go

# 2. Adicionar CRUD de telefone
ai "adicione end-points CRUD para telefones" /home/lambertini/api-go

# 3. Criar interface web para testar
ai "crie uma interface web para interagir com os end-points" /home/lambertini/api-go

# 4. Iniciar servidor
cd /home/lambertini/api-go/go && ./app

# 5. Acessar no navegador
firefox http://localhost:8080/
```

---

## 📜 Licença

MIT License - Use livremente para fins pessoais e comerciais.

---

## 🤝 Contribuição

Sinta-se à vontade para:
1. Reportar bugs
2. Sugerir melhorias
3. Enviar pull requests

---

## 📧 Contato

Dúvidas ou sugestões? Abra uma issue no repositório.

---

**🚀 Desenvolvido com foco em execução local, privacidade e autonomia. Tipo um mini OpenDevin, mas rodando na sua máquina!**
