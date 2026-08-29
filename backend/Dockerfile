FROM python:3.10-slim

WORKDIR /app

# Install system build dependencies for LightGBM
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY . .

# Train policy model if dataset exists
RUN python -c "from src.policy_model import RecoveryPolicyModel; model = RecoveryPolicyModel(); model.train('data/train.csv' if __import__('os').path.exists('data/train.csv') else 'train.csv')" || true

# Expose Hugging Face Spaces default port 7860
EXPOSE 7860

# Run FastAPI server via Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
