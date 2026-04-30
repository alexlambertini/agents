from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import LabelEncoder
import numpy as np
import joblib
from pathlib import Path

class ActionClassifier:
    def __init__(self, model_path="data/models/classifier.joblib"):
        self.model = RandomForestClassifier(n_estimators=100, random_state=42)
        self.vectorizer = TfidfVectorizer(max_features=500)
        self.label_encoder = LabelEncoder()
        self.model_path = Path(model_path)
        self.accuracy = 0.0
        
        # Carregar modelo se existir
        if self.model_path.exists():
            self.load()
    
    def train(self, examples: list):
        """Treina classificador com exemplos históricos"""
        
        # Extrair features
        X_texts = []
        y_labels = []
        
        for ex in examples:
            # Feature: texto do erro
            error_text = ex.get('error', '')
            X_texts.append(error_text)
            
            # Label: ação que resolveu
            y_labels.append(ex.get('successful_action', 'read_file'))
        
        if len(X_texts) < 10:
            print(f"Poucos exemplos para treinar: {len(X_texts)}")
            return
        
        # Transformar textos em features
        X = self.vectorizer.fit_transform(X_texts)
        y = self.label_encoder.fit_transform(y_labels)
        
        # Treinar modelo
        self.model.fit(X, y)
        
        # Calcular acurácia (cross-validation simplificada)
        from sklearn.model_selection import cross_val_score
        scores = cross_val_score(self.model, X, y, cv=min(5, len(X_texts)))
        self.accuracy = scores.mean()
        
        # Salvar modelo
        self.save()
        
        print(f"Modelo treinado com acurácia: {self.accuracy:.2f}")
    
    def predict_error_type(self, error: str) -> str:
        """Prediz o tipo do erro"""
        error_types = {
            'syntax': ['unexpected', 'syntax error', 'missing', 'undefined'],
            'runtime': ['panic', 'nil pointer', 'index out of range'],
            'dependency': ['cannot find package', 'module not found'],
            'path': ['no such file', 'cannot open', 'permission denied'],
            'network': ['connection refused', 'timeout', 'EOF'],
        }
        
        error_lower = error.lower()
        for error_type, keywords in error_types.items():
            if any(keyword in error_lower for keyword in keywords):
                return error_type
        
        return 'unknown'
    
    def predict_action(self, error: str, task: str) -> dict:
        """Prediz a melhor ação baseada no erro"""
        
        if not hasattr(self.model, 'predict_proba'):
            return {'action': 'read_file', 'confidence': 0.5}
        
        # Transformar texto
        X = self.vectorizer.transform([error])
        
        # Predizer
        pred_proba = self.model.predict_proba(X)[0]
        pred_class = np.argmax(pred_proba)
        confidence = pred_proba[pred_class]
        
        action = self.label_encoder.inverse_transform([pred_class])[0]
        
        # Top 3 alternativas
        top_indices = np.argsort(pred_proba)[-3:][::-1]
        alternatives = [
            {
                'action': self.label_encoder.inverse_transform([idx])[0],
                'confidence': pred_proba[idx]
            }
            for idx in top_indices
        ]
        
        return {
            'action': action,
            'confidence': float(confidence),
            'alternatives': alternatives
        }
    
    def save(self):
        """Salva modelo treinado"""
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({
            'model': self.model,
            'vectorizer': self.vectorizer,
            'label_encoder': self.label_encoder,
            'accuracy': self.accuracy
        }, self.model_path)
    
    def load(self):
        """Carrega modelo salvo"""
        data = joblib.load(self.model_path)
        self.model = data['model']
        self.vectorizer = data['vectorizer']
        self.label_encoder = data['label_encoder']
        self.accuracy = data['accuracy']
