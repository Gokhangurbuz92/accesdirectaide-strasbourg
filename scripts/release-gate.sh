#!/bin/bash
set -e

echo "=== Pre-flight Release Gate ==="

echo "1. Validating environment variables..."
if [ -z "$DATABASE_URL" ]; then
    echo "ENVIRONMENT ACTION REQUIRED: DATABASE_URL is missing. Please provide a real environment to run the release gate."
    exit 1
fi

echo "2. Dependency Audit..."
# Do not swallow audit errors. Note if network fails.
npm audit --omit=dev || {
    echo "ENVIRONMENT ACTION REQUIRED: npm audit failed or network blocked."
    exit 1
}

echo "3. Secret Scan (gitleaks)..."
if command -v gitleaks &> /dev/null; then
    gitleaks detect -v || { echo "Gitleaks failed"; exit 1; }
else
    echo "ENVIRONMENT ACTION REQUIRED: gitleaks not installed."
    exit 1
fi

echo "4. Required Quality Gates..."
npm run lint || { echo "Lint failed"; exit 1; }
npm run typecheck || { echo "Typecheck failed"; exit 1; }
npm run build || { echo "Build failed"; exit 1; }
npm run test:unit || { echo "Unit tests failed"; exit 1; }
npm run test:ci || { echo "CI integration tests failed"; exit 1; }

echo "=== Pre-flight Complete ==="
