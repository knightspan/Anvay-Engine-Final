# ANVAY Automation Script (Windows)

Write-Host "ANVAY --- Sovereign Strategic Intelligence System Setup" -ForegroundColor Cyan

# 1. Docker
Write-Host "[1/5] Starting Infrastructure (Kafka, Zookeeper, Neo4j)..." -ForegroundColor Yellow
docker-compose up -d

# 2. Backend
Write-Host "[2/5] Setting up Backend..." -ForegroundColor Yellow
cd backend
if (-Not (Test-Path "venv")) {
    python -m venv venv
}
.\venv\Scripts\activate
pip install -r requirements.txt
python -m spacy download en_core_web_sm

# 3. Env
Write-Host "[3/5] Configuring Environment..." -ForegroundColor Yellow
if (-Not (Test-Path "..\.env")) {
    cp ..\.env.example ..\.env
    Write-Host "  ! Initialized .env from template. PLEASE ADD YOUR API KEYS!" -ForegroundColor Red
}

# 4. Seed Graph
Write-Host "[4/5] Seeding Knowledge Graph..." -ForegroundColor Yellow
# Wait for Neo4j to be ready
Write-Host "  Wait for Neo4j to initialize (15s)..."
Start-Sleep -s 15
python seed_graph.py

# 5. Frontend
Write-Host "[5/5] Setting up Frontend..." -ForegroundColor Yellow
cd ..\frontend\anvay-dashboard
npm install

Write-Host "`n✓ SETUP COMPLETE!" -ForegroundColor Green
Write-Host "To start the system:"
Write-Host "1. (Terminal A) cd backend; .\venv\Scripts\activate; python main.py"
Write-Host "2. (Terminal B) cd frontend/anvay-dashboard; npm run dev"
