import ollama
import numpy as np
from typing import List, Union
import asyncio
from functools import lru_cache

class EmbeddingGenerator:
    def __init__(self, model="nomic-embed-text"):
        self.model = model
        self.cache = {}
    
    def embed(self, text: str) -> List[float]:
        """Gera embedding para texto usando Ollama (synchronous)"""
        
        # Cache em memória
        if text in self.cache:
            return self.cache[text]
        
        try:
            response = ollama.embeddings(
                model=self.model,
                prompt=text
            )
            embedding = response['embedding']
            self.cache[text] = embedding
            return embedding
        except Exception as e:
            print(f"Erro ao gerar embedding: {e}")
            # Fallback: embedding aleatório determinístico
            return self._fallback_embedding(text)
    
    async def embed_async(self, text: str) -> List[float]:
        """Versão async para uso em endpoints FastAPI"""
        import asyncio
        return await asyncio.to_thread(self.embed, text)
    
    def _fallback_embedding(self, text: str) -> List[float]:
        """Embedding simples baseado em caracteres (fallback)"""
        import hashlib
        hash_obj = hashlib.sha256(text.encode())
        hash_bytes = hash_obj.digest()
        embedding = [float(b) / 255.0 for b in hash_bytes[:128]]
        # Padding se necessário
        while len(embedding) < 128:
            embedding.append(0.0)
        return embedding[:128]
    
    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Gera embeddings para múltiplos textos em paralelo"""
        tasks = [self.embed(text) for text in texts]
        return await asyncio.gather(*tasks)
    
    def similarity(self, emb1: List[float], emb2: List[float]) -> float:
        """Calcula similaridade de cosseno entre dois embeddings"""
        arr1 = np.array(emb1)
        arr2 = np.array(emb2)
        return np.dot(arr1, arr2) / (np.linalg.norm(arr1) * np.linalg.norm(arr2))
