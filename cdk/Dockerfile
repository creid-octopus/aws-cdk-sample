FROM octopuslabs/aws-workertools:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs \
    && npm install -g aws-cdk \
    && rm -rf /var/lib/apt/lists/*
