from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
import numpy as np
from typing import List, Dict
from collections import defaultdict

class ErrorClusterer:
    def __init__(self, n_clusters=5):
        self.kmeans = KMeans(n_clusters=n_clusters, random_state=42)
        self.scaler = StandardScaler()
        self.cluster_labels = {}
        self.error_samples = defaultdict(list)
        self.is_fitted = False
    
    def add_error_sample(self, error: str, embedding: List[float]):
        """Adiciona amostra de erro para clusterização"""
        error_hash = hash(error)
        self.error_samples[error_hash].append({
            'error': error,
            'embedding': embedding,
            'timestamp': None
        })
    
    def fit(self, embeddings: List[List[float]]):
        """Treina clusterizador com embeddings existentes"""
        if len(embeddings) < self.kmeans.n_clusters:
            print(f"Poucos embeddings para clusterizar: {len(embeddings)}")
            return
        
        X = np.array(embeddings)
        X_scaled = self.scaler.fit_transform(X)
        self.kmeans.fit(X_scaled)
        self.is_fitted = True
    
    def get_cluster(self, embedding: List[float]) -> int:
        """Retorna cluster de um embedding"""
        if not self.is_fitted:
            return -1
        
        X = self.scaler.transform([embedding])
        return int(self.kmeans.predict(X)[0])
    
    def get_cluster_characteristics(self, cluster_id: int) -> dict:
        """Retorna características de um cluster"""
        if not self.is_fitted:
            return {}
        
        center = self.kmeans.cluster_centers_[cluster_id]
        
        samples = []
        for error_hash, samples_list in self.error_samples.items():
            for sample in samples_list:
                emb = np.array(sample['embedding'])
                dist = np.linalg.norm(emb - center)
                if dist < 1.0:
                    samples.append(sample['error'])
        
        return {
            'cluster_id': cluster_id,
            'size': len(samples),
            'sample_errors': samples[:5],
            'center_distance': float(np.linalg.norm(center))
        }
    
    def get_cluster_count(self) -> int:
        return self.kmeans.n_clusters if self.is_fitted else 0
    
    def find_similar_errors(self, embedding: List[float], k=3) -> List[Dict]:
        """Encontra erros similares no mesmo cluster"""
        if not self.is_fitted:
            return []
        
        cluster_id = self.get_cluster(embedding)
        if cluster_id == -1:
            return []
        
        similar = []
        for error_hash, samples in self.error_samples.items():
            for sample in samples:
                if self.get_cluster(sample['embedding']) == cluster_id:
                    similarity = self._cosine_similarity(embedding, sample['embedding'])
                    similar.append({
                        'error': sample['error'][:200],
                        'similarity': similarity
                    })
        
        similar.sort(key=lambda x: x['similarity'], reverse=True)
        return similar[:k]
    
    def _cosine_similarity(self, a, b):
        a = np.array(a)
        b = np.array(b)
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
