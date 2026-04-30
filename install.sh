#!/bin/bash
# install.sh - Instalador completo do AI CLI
# Funciona em qualquer máquina Linux/Mac (zero configuração)

set -e

echo "🚀 AI CLI - Instalador Completo"
echo "================================="
echo ""

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Diretório de instalação
INSTALL_DIR="$HOME/.ai-cli"
BIN_LINK="/usr/local/bin/ai"

echo -e "${BLUE}📁 Diretório de instalação: ${INSTALL_DIR}${NC}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 1. Verificar/Instalar Node.js
echo -e "${YELLOW}🔍 Verificando Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}⚠️  Node.js não encontrado. Instalando...${NC}"
    if command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v yum &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
        sudo yum install -y nodejs
    else
        echo -e "${RED}❌ Instale o Node.js manualmente: https://nodejs.org${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}✅ Node.js $(node --version)${NC}"

# 2. Verificar/Instalar Ollama
echo -e "${YELLOW}🔍 Verificando Ollama...${NC}"
if ! command -v ollama &> /dev/null; then
    echo -e "${YELLOW}⚠️  Ollama não encontrado. Instalando...${NC}"
    curl -fsSL https://ollama.com/install.sh | sh
fi
echo -e "${GREEN}✅ Ollama instalado${NC}"

# 3. Baixar arquivos do projeto
echo -e "${YELLOW}📦 Baixando AI CLI...${NC}"
if [ ! -f "index.js" ]; then
    # Se estiver em um repositório git, usar git clone
    if [ -z "$1" ]; then
        echo -e "${BLUE}Clone do repositório padrão...${NC}"
        git clone https://github.com/alexlambertini/agents.git .
    else
        echo -e "${BLUE}Usando repositório fornecido: $1${NC}"
        git clone "$1" .
    fi
else
    echo -e "${GREEN}✅ Arquivos já existem${NC}"
fi

# 4. Instalar dependências Node.js
echo -e "${YELLOW}📦 Instalando dependências Node.js...${NC}"
npm install
echo -e "${GREEN}✅ Dependências instaladas${NC}"

# 5. Tornar executável
chmod +x index.js

# 6. Criar link simbólico
echo -e "${YELLOW}🔗 Criando comando global 'ai'...${NC}"
if [ -w "/usr/local/bin" ]; then
    ln -sf "$INSTALL_DIR/index.js" "$BIN_LINK"
else
    sudo ln -sf "$INSTALL_DIR/index.js" "$BIN_LINK"
fi
echo -e "${GREEN}✅ Comando 'ai' disponível globalmente${NC}"

# 7. Configurar Ollama (perguntar qual modelo)
echo -e "${BLUE}🤖 Configuração do Modelo LLM${NC}"
echo "Modelos disponíveis:"
echo "  1) agent-os (recomendado - customizado para agentes)"
echo "  2) qwen2.5-coder:7b (padrão - código)"
echo "  3) qwen2.5-coder:7b-opencode (versão opencode)"
echo "  4) Outro (especificar)"
echo ""
read -p "Escolha uma opção (1-4): " model_choice

case $model_choice in
    1) MODEL="agent-os" ;;
    2) MODEL="qwen2.5-coder:7b" ;;
    3) MODEL="qwen2.5-coder:7b-opencode" ;;
    4) read -p "Digite o nome do modelo: " MODEL ;;
    *) MODEL="agent-os" ;;
esac

echo -e "${YELLOW}📥 Baixando modelo: $MODEL${NC}"
ollama pull "$MODEL"
echo -e "${GREEN}✅ Modelo $MODEL baixado${NC}"

# 8. Configurar modelo no index.js
sed -i "s/const MODEL = \".*\"/const MODEL = \"$MODEL\"/" index.js
echo -e "${GREEN}✅ Modelo configurado no index.js${NC}"

# 9. (Opcional) Instalar ML Service
echo -e "${BLUE}🧠 Machine Learning Service (Opcional)${NC}"
read -p "Deseja instalar o ML Service? (y/n): " install_ml
if [ "$install_ml" = "y" ] || [ "$install_ml" = "Y" ]; then
    echo -e "${YELLOW}🐍 Configurando ambiente Python...${NC}"
    python3 -m venv ml-env
    source ml-env/bin/activate
    pip install fastapi uvicorn numpy scikit-learn pandas joblib ollama
    echo -e "${GREEN}✅ ML Service configurado${NC}"
    echo -e "${BLUE}📝 Para iniciar o ML Service:${NC}"
    echo "   cd $INSTALL_DIR"
    echo "   source ml-env/bin/activate"
    echo "   python -m uvicorn ml_service.main:app --host 0.0.0.0 --port 8000"
fi

# 10. Iniciar Ollama em background
echo -e "${YELLOW}🚀 Iniciando Ollama...${NC}"
if ! pgrep -x "ollama" > /dev/null; then
    nohup ollama serve > /dev/null 2>&1 &
    sleep 3
    echo -e "${GREEN}✅ Ollama rodando em background${NC}"
else
    echo -e "${GREEN}✅ Ollama já está rodando${NC}"
fi

echo ""
echo -e "${GREEN}=================================${NC}"
echo -e "${GREEN}✅ INSTALAÇÃO COMPLETA!${NC}"
echo -e "${GREEN}=================================${NC}"
echo ""
echo -e "${BLUE}📖 Como usar:${NC}"
echo "  ai \"sua tarefa aqui\" /caminho/do/projeto"
echo ""
echo -e "${BLUE}📖 Exemplos:${NC}"
echo "  ai \"criar API Go com CRUD\" ~/meu-projeto"
echo "  ai \"adicionar interface web\" ~/meu-projeto"
echo ""
echo -e "${BLUE}🔧 Comandos úteis:${NC}"
echo "  ai help          - Mostra ajuda"
echo "  ollama list      - Lista modelos instalados"
echo "  ai --version     - Versão instalada"
echo ""
