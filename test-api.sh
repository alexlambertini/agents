#!/bin/bash
# test-api.sh - Testa API Go + SQLite CRUD

set -e

PROJECT_DIR="/tmp/teste-final/go"
DB_FILE="$PROJECT_DIR/todos.db"

echo "🧪 Testando API Go + SQLite CRUD"
echo "================================"

# 1. Compile o projeto
echo -e "\n📦 Compilando..."
cd "$PROJECT_DIR"
go mod tidy
go build -o app .

# 2. Inicie o servidor em background
echo -e "\n🚀 Iniciando servidor..."
./app &
SERVER_PID=$!
sleep 2

# 3. Teste os endpoints
echo -e "\n🧪 Testando endpoints..."

# GET inicial (deve retornar vazio)
echo -e "\n1. GET /todos (inicial):"
curl -s http://localhost:8080/todos | python3 -m json.tool

# POST (criar TODO)
echo -e "\n2. POST /todos (criar):"
curl -s -X POST http://localhost:8080/todos \
  -H "Content-Type: application/json" \
  -d '{"title":"Comprar leite","done":false}' | python3 -m json.tool

# GET (deve mostrar o item)
echo -e "\n3. GET /todos (após criar):"
curl -s http://localhost:8080/todos | python3 -m json.tool

# PUT (atualizar)
echo -e "\n4. PUT /todos (atualizar id=1):"
curl -s -X PUT "http://localhost:8080/todos?id=1" \
  -H "Content-Type: application/json" \
  -d '{"title":"Comprar leite e pão","done":true}' | python3 -m json.tool

# GET (ver atualização)
echo -e "\n5. GET /todos (após atualizar):"
curl -s http://localhost:8080/todos | python3 -m json.tool

# DELETE
echo -e "\n6. DELETE /todos (deletar id=1):"
curl -s -X DELETE "http://localhost:8080/todos?id=1" | python3 -m json.tool

# GET final
echo -e "\n7. GET /todos (final):"
curl -s http://localhost:8080/todos | python3 -m json.tool

# 4. Limpeza
echo -e "\n🧹 Limpeza..."
kill $SERVER_PID 2>/dev/null || true
rm -f "$PROJECT_DIR/app" "$DB_FILE"

echo -e "\n✅ Testes concluídos!"
