import numpy as np
from typing import List, Dict, Any

class VectorMemory:
    def __init__(self, max_size=10000):
        self.vectors = []
        self.metadata = []
        self.max_size = max_size

    def add_positive_example(self, embedding: List[float], action: Dict):
        self.vectors.append(embedding)
        self.metadata.append({
            'type': 'positive',
            'action': action,
            'timestamp': None
        })
        self._trim_if_needed()

    def add_negative_example(self, embedding: List[float], action: Dict):
        self.vectors.append(embedding)
        self.metadata.append({
            'type': 'negative',
            'action': action,
            'timestamp': None
        })
        self._trim_if_needed()

    def search_similar(self, query_embedding: List[float], k=5) -> List[Dict]:
        # Validação básica: lista vazia ou nenhum vetor armazenado
        if not self.vectors or not query_embedding:
            return []

        query = np.array(query_embedding)
        vectors = np.array(self.vectors)

        # Verifica se a dimensionalidade do query coincide com a dos vetores
        if vectors.ndim != 2 or query.ndim != 1 or vectors.shape[1] != len(query):
            # Dimensionalidade incompatível – retorna vazio
            return []

        norms = np.linalg.norm(vectors, axis=1)
        query_norm = np.linalg.norm(query)

        if query_norm == 0 or np.any(norms == 0):
            # Fallback: similaridade baseada na distância L1 normalizada
            distances = np.sum(np.abs(vectors - query), axis=1)
            max_dist = distances.max() if distances.size > 0 else 1.0
            if max_dist == 0:
                similarities = np.ones_like(distances)
            else:
                similarities = 1.0 - (distances / max_dist)
        else:
            similarities = np.dot(vectors, query) / (norms * query_norm)

        # Obtém os índices dos k mais similares
        indices = np.argsort(similarities)[-k:][::-1]

        results = []
        for idx in indices:
            results.append({
                'similarity': float(similarities[idx]),
                'type': self.metadata[idx]['type'],
                'action': self.metadata[idx]['action']
            })
        return results

    def get_all_examples(self) -> List[Dict]:
        examples = []
        for meta in self.metadata:
            if meta['type'] == 'positive':
                # Não existe 'error' nos metadados, então usamos um valor padrão
                examples.append({
                    'error': '',
                    'successful_action': meta['action'].get('name', 'read_file')
                })
        return examples

    def get_all_embeddings(self) -> List[List[float]]:
        return self.vectors.copy()

    def size(self) -> int:
        return len(self.vectors)

    def _trim_if_needed(self):
        if len(self.vectors) > self.max_size:
            excess = len(self.vectors) - self.max_size
            self.vectors = self.vectors[excess:]
            self.metadata = self.metadata[excess:]
