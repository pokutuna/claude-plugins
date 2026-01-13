#!/bin/bash
# Detect commands in workflows that are likely unavailable on ubuntu-slim.
# Usage: ./check-slim-compat.sh [workflow-file...]

# Commands not preinstalled on ubuntu-slim unless added manually.
readonly KEYWORDS_REGEX='\b(docker|podman|buildah|docker-compose|kubectl|helm|aws|gcloud|az|heroku|doctl|oci|java|javac|mvn|gradle|sbt|ant|dotnet|msbuild|nuget|pipenv|poetry|bundle|cargo|go build|bazel|terraform|packer)\b'

grep -n -i -E "$KEYWORDS_REGEX" "$@" || true
