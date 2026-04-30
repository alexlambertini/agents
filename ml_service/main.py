from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import ollama
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
import joblib
import json
from pathlib import Path
from datetime import datetime
import asyncio

from ml_service.embeddings import EmbeddingGenerator
from ml_service.classifier import ActionClassifier
from ml_service.cluster import ErrorClusterer
from ml_service.rl_agent import RLActionOptimizer
from ml_service.memory_store import VectorMemory

app = FastAPI(title="ML Service for Agent OS")

# Inicializar componentes
embedder = EmbeddingGenerator()
classifier = ActionClassifier()
clusterer = ErrorClusterer()
rl_optimizer = RLActionOptimizer()
vector_memory = VectorMemory()

class ErrorContext(BaseModel):
    error: str
    task: str
    last_action: Dict[str, Any]
    file_path: Optional[str] = None
    language: str = "go"

class ActionPrediction(BaseModel):
    recommended_action: str
    confidence: float
    alternatives: List[Dict[str, float]]

class StrategySuggestion(BaseModel):
    strategy: str
    suggestion: Dict[str, Any]
    confidence: float
    similar_past_cases: List[Dict]

@app.post("/analyze-error")
async def analyze_error(context: ErrorContext):
    """Endpoint principal: analisa erro e sugere ação"""
    
    # 1. Gerar embedding do erro
    error_embedding = await embedder.embed_async(context.error)
    
    # 2. Buscar casos similares no histórico
    similar_cases = vector_memory.search_similar(error_embedding, k=5)
    
    # 3. Classificar tipo de erro
    error_type = classifier.predict_error_type(context.error)
    
    # 4. Sugerir ação baseado em similaridade
    suggested_action = await rl_optimizer.suggest_action(
        error=context.error,
        task=context.task,
        last_action=context.last_action,
        similar_cases=similar_cases
    )
    
    # 5. Se confiança baixa, usar fallback para regras
    if suggested_action['confidence'] < 0.7:
        suggested_action = fallback_rules(context)
    
    return {
        "error_type": error_type,
        "embedding_dim": len(error_embedding),
        "similar_cases_count": len(similar_cases),
        "suggestion": suggested_action,
        "similar_past_errors": similar_cases[:3]
    }

@app.post("/learn-success")
async def learn_success(data: Dict[str, Any]):
    """Aprende com ações bem-sucedidas"""
    
    # Extrair dados
    task = data['task']
    actions = data['actions']
    final_state = data.get('final_state', {})
    
    # Gerar embeddings positivos
    for action in actions:
        embedding = await embedder.embed_async(json.dumps(action))
        vector_memory.add_positive_example(embedding, action)
    
    # Atualizar RL agent (reforço positivo)
    rl_optimizer.add_reward(actions, reward=1.0)
    
    # Retreinar modelos periodicamente
    if should_retrain():
        await retrain_models()
    
    return {"status": "learned", "examples": len(actions)}

@app.post("/learn-failure")
async def learn_failure(data: Dict[str, Any]):
    """Aprende com ações que falharam"""
    
    error = data['error']
    action = data['action']
    task = data['task']
    
    # Gerar embedding do erro
    error_embedding = await embedder.embed_async(error)
    
    # Armazenar no banco vetorial (negativo)
    vector_memory.add_negative_example(error_embedding, action)
    
    # Atualizar RL agent (reforço negativo)
    rl_optimizer.add_reward([action], reward=-0.5)
    
    # Atualizar clusterização
    clusterer.add_error_sample(error, error_embedding)
    
    return {"status": "recorded", "cluster": clusterer.get_cluster(error_embedding)}

@app.get("/model-stats")
async def get_model_stats():
    """Retorna estatísticas do modelo ML"""
    return {
        "total_embeddings": vector_memory.size(),
        "clusters": clusterer.get_cluster_count(),
        "classifier_accuracy": classifier.accuracy,
        "rl_q_table_size": rl_optimizer.q_table_size()
    }

def fallback_rules(context: ErrorContext):
    """Fallback para quando ML tem baixa confiança"""
    if "patch" in context.last_action.get('name', ''):
        return {
            "recommended_action": "write_file",
            "confidence": 0.5,
            "reason": "ML low confidence, using rule-based fallback"
        }
    return {
        "recommended_action": "read_file",
        "confidence": 0.5,
        "reason": "Default fallback"
    }

def should_retrain():
    """Decide quando retreinar modelos"""
    return vector_memory.size() % 100 == 0

async def retrain_models():
    """Retreina todos os modelos ML"""
    classifier.train(vector_memory.get_all_examples())
    clusterer.fit(vector_memory.get_all_embeddings())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
